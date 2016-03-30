"use strict";
var assert = require('better-assert');
var belt = require('./belt');
var crypto = require('co-crypto');
var config = require('config');
var debug = require('debug')('app:db');
var util = require('util');
var pg = require('co-pg')(require('pg'));
var _ = require('lodash');
var m = require('multiline');

var Payouts = require('./payouts');
var kellyComputations = require('./kelly_computations');

// parse int8 as an integer
// TODO: Handle numbers past parseInt range
pg.types.setTypeParser(20, function(val) {
    return val === null ? null : parseInt(val);
});

pg.on('error', function(err) {
  console.error('POSTGRES EMITTED AN ERROR', err);
  belt.logError(err);
});


var databaseUrl = config.get('DATABASE_URL');

function *query(sql, params) {
  var connResult = yield pg.connectPromise(databaseUrl);
  var client = connResult[0];
  var done = connResult[1];
  try {
    return yield client.queryPromise(sql, params);
  } finally {
    done();  // Release client back to pool, even if there was a query error
  }

}
exports.query = query;

function *queryOne(sql, params) {
  var result = yield query(sql, params);
  assert(result.rows.length <= 1);
  return result.rows[0];
}

function *queryMany(sql, params) {
  var result = yield query(sql, params);
  return result.rows;
}

// Runner takes a client,
// and never BEGIN or COMMIT a transaction.
function* withTransaction(runner) {

  return yield withClient(function*(client) {
    try {
      yield client.queryPromise('BEGIN');
      var r = yield runner(client);
      yield client.queryPromise('COMMIT');
      return r;
    } catch (ex) {
      try {
        yield client.queryPromise('ROLLBACK');
      } catch(ex) {
        ex.removeFromPool = true;
        throw ex;
      }
      throw ex;
    }

  });

}

// Runner will be recalled if deadlocked
function* withClient(runner) {
  var connResult = yield pg.connectPromise(databaseUrl);
  var client = connResult[0];
  var done = connResult[1];

  var r;
  try {
    r = yield runner(client);
  } catch (ex) {
    if (ex.removeFromPool) {
      ex.human = 'Could not remove from pool';
      belt.logError(ex);
      done(new Error('Removing connection from pool'));
      throw ex;
    } else if (ex.code === '40P01') { // Deadlock
      done();
      return yield withClient(runner);
    } else {
      done();
      throw ex;
    }
  }

  done();
  return r;
}

function *decreaseUserBalance(client, userId, amount) {
  var sql = 'UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1';
  var r = yield client.queryPromise(sql, [amount, userId]);
  if (r.rowCount !== 1)
    throw 'NOT_ENOUGH_BALANCE';
  return r;
}

function* updateUserPassword(client, userId, password, currentSessionId) {
  assert(client);
  assert(_.isNumber(userId));
  assert(_.isString(password));
  assert(currentSessionId === null || belt.isValidUuid(currentSessionId));

  var digest = yield belt.hashPassword(password);

  var updateSessions = m(function() {/*
   UPDATE sessions SET logged_out_at = NOW()
   WHERE user_id = $1
   AND logged_out_at IS NULL
   AND expired_at > NOW()
   AND (CASE WHEN $2::uuid IS NULL THEN true ELSE id != $2 END)
   */});

  yield client.queryPromise(updateSessions, [userId, currentSessionId]);

  var expireTokens = m(function() {/*
   UPDATE tokens SET expired_at = NOW()
   WHERE auth_id IN (
   SELECT id FROM auths WHERE user_id = $1
   ) AND expired_at > NOW()
   */});

  yield client.queryPromise(expireTokens, [userId]);

  var updateUser = m(function() {/*
   UPDATE users
   SET digest = $1
   WHERE id = $2
   RETURNING *
   */});
  var result = yield client.queryPromise(updateUser, [digest, userId]);
  if(result.rowCount !== 1)
    throw 'INVALID_USER_ID';

  return result.rows[0];
}


// currentSessionId can be null
exports.updateUserPassword = function*(userId, password, currentSessionId) {

  return yield withTransaction(function*(client) {
    return yield updateUserPassword(client, userId, password, currentSessionId);
  });

};

// Note: Case-insensitive
exports.findUserByUname = findUserByUname;
function *findUserByUname(uname) {
  debug('[findUserByUname] uname: ' + uname);
  var sql = m(function() {/*
SELECT *
FROM users u
WHERE lower(u.uname) = lower($1);
  */});
  return (yield query(sql, [uname])).rows[0];
}

// Note: Case-insensitive
exports.findUserByEmail = function *(email) {
  debug('[findUserByEmail] email: ' + email);
  var sql = 'SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1'; // TODO: list them all
  return yield queryOne(sql, [email]);
};

exports.getUserPublicStats = function*(userId) {
  var sql = m(function() {/*
   SELECT
     json_build_object('id', apps.id, 'name', apps.name) AS app,
     betted_count - reset_betted_count AS betted_count,
     betted_profit - reset_betted_profit AS betted_profit,
     betted_wager - reset_betted_wager AS betted_wager
   FROM auths
   JOIN apps ON apps.id = auths.app_id
   WHERE auths.user_id = $1 AND betted_wager > reset_betted_wager
   ORDER BY betted_ev ASC
  */});

  var result = yield query(sql, [userId]);
  return result.rows;
};

exports.getUnameFromId = function*(userId) {
  var sql = 'SELECT uname FROM users WHERE id = $1';
  var row = yield queryOne(sql, [userId]);
  return row ? row.uname : row;
};

exports.createResetToken = function*(userId) {
  debug('[createResetToken] userId: ' + userId);
  var sql = m(function() {/*
INSERT INTO reset_tokens (id, user_id)
VALUES (uuid_generate_v4(), $1)
RETURNING *
  */});
  var result = yield query(sql, [userId]);
  return result.rows[0];
};

exports.findLatestActiveResetToken = function*(userId) {
  assert(_.isNumber(userId));
  var sql = m(function() {/*
SELECT *
FROM reset_tokens
WHERE user_id = $1 AND expired_at > NOW()
ORDER BY created_at DESC
LIMIT 1
  */});
  var result = yield query(sql, [userId]);
  return result.rows[0];
};


// Returns userId if successful
exports.resetUserPasswordByToken = function*(resetToken, password) {

  return yield withTransaction(function*(client) {
    var sql = m(function() {/*
      UPDATE reset_tokens SET used = true, expired_at = NOW()
      WHERE id = $1 AND used = false AND expired_at > NOW()
      RETURNING user_id
    */});

    var r = yield client.queryPromise(sql, [resetToken]);

    if (r.rowCount !== 1)
      throw 'INVALID_RESET_TOKEN';

    var userId = r.rows[0].user_id;
    assert(userId);

    yield updateUserPassword(client, userId, password, null);

    yield client.queryPromise(
      'UPDATE reset_tokens SET expired_at = NOW() WHERE user_id = $1 AND expired_at > NOW()', [userId]);

    return userId;
  });

};

function *createSession(client, props) {
  debug('[createSession] props: ' + util.inspect(props));
  assert(_.isNumber(props.user_id));
  assert(_.isString(props.ip_address));
  assert(_.isString(props.interval));
  var sql = m(function () {/*
   INSERT INTO sessions (user_id, id, ip_address, expired_at)
   VALUES ($1, uuid_generate_v4(), $2::inet, NOW() + $3::interval)
   RETURNING *
   */});
  var result = yield client.queryPromise(sql, [props.user_id, props.ip_address, props.interval]);
  return result.rows[0];
}

exports.createSession = function*(props){
  return yield withClient(function*(client) {
    return yield createSession(client, props);
  });
};


// Creates a user and their initial wallet
exports.createUser = function *createUserWithSession(attrs) {
  debug('[createUser] attrs: ' + util.inspect(attrs));
  assert(_.isString(attrs.uname));
  assert(_.isString(attrs.ip_address));
  assert(_.isString(attrs.password));

  var digest = yield belt.hashPassword(attrs.password);

  return yield withTransaction(function*(client) {

    var insertSql = m(function () {/*
     INSERT INTO users (uname, digest, email)
     VALUES ($1, $2, $3)
     RETURNING *;
     */});

    var result = yield client.queryPromise(insertSql, [
      attrs.uname, digest, attrs.email
    ]);
    var user = result.rows[0];
    assert(user);
    debug('Registered user: ', user);

    yield generateAddress(client, user.id, null, false, 'Initial Address', true);

    return user;
  });

};

////////////////////////////////////////////////////////////


exports.findUserBySessionId = findUserBySessionId;
function *findUserBySessionId(sessionId) {
  assert(belt.isValidUuid(sessionId));
  var sql = m(function() {/*
SELECT
  users.*,
  SUM(auths.balance) total_auth_balance
FROM users
JOIN active_sessions ON users.id = active_sessions.user_id
LEFT OUTER JOIN auths ON users.id = auths.user_id
WHERE active_sessions.id = $1
GROUP BY users.id
  */});
  return yield queryOne(sql, [sessionId]);
}

// Returns updated Address
exports.updateAddressMemo = function*(userId, address, memo) {
  assert(_.isNumber(userId));
  assert(_.isString(address));
  assert(_.isString(memo));
  var sql = m(function() {/*
UPDATE user_addresses
SET memo = $1
WHERE address = $2 AND user_id = $3
RETURNING *
  */});

  var rc = (yield query(sql, [memo, address, userId])).rowCount;
  assert(rc === 0 || rc === 1);

  return rc === 1;
};

// - Pass in `userId` to ensure we are only looking up addresses that
//   belong to that user.
exports.findAddressForUserByAddressString = findAddressForUserByAddressString;
function *findAddressForUserByAddressString(userId, addressString) {
  assert(_.isNumber(userId));
  assert(_.isString(addressString));
  var sql = m(function() {/*
SELECT ua.*
FROM user_addresses ua
JOIN users u ON ua.user_id = u.id
WHERE u.id = $1 AND ua.address = $2
  */});
  var result = yield query(sql, [userId, addressString]);
  return result.rows[0] || null;
}


// Logs out the session that this user owns
exports.logoutSession = logoutSession;
function *logoutSession(userId, sessionId) {
  assert(_.isNumber(userId));
  assert(_.isString(sessionId) && belt.isValidUuid(sessionId));
  var sql = m(function() {/*
UPDATE sessions
SET logged_out_at = NOW()
WHERE user_id = $1
      AND id = $2
  */});
  return yield query(sql, [userId, sessionId]);
}

// Returns wallets from oldest to newest.
// First wallet is the user's primary wallet.
// Will always return at least one wallet.
exports.findAllWalletsForUserId = findAllWalletsForUserId;
function *findAllWalletsForUserId(userId) {
  assert(_.isNumber(userId));
  var sql = m(function() {/*
SELECT *
FROM wallets
WHERE user_id = $1
ORDER BY id
  */});
  var wallets = (yield query(sql, [userId])).rows;
  assert(wallets.length >= 1);
  return wallets;
}

// Returns updated wallet
exports.updateWalletName = updateWalletName;
function *updateWalletName(walletId, name) {
  assert(_.isNumber(walletId));
  assert(_.isString(name));
  var sql = m(function() {/*
UPDATE wallets
SET name = $2
WHERE id = $1
RETURNING *
  */});
  var result = yield query(sql, [walletId, name]);
  return result.rows[0];
}

// Throws 'PASSCODE_ALREADY_USED' if passcode already exists in
// table 'mfa_passcodes' for this user.
exports.insertMFAPasscode = insertMFAPasscode;
function *insertMFAPasscode(userId, passcode) {
  assert(_.isNumber(userId));
  assert(_.isString(passcode));
  var sql = m(function() {/*
INSERT INTO mfa_passcodes (user_id, passcode)
VALUES ($1, $2)
  */});
  try {
    yield query(sql, [userId, passcode]);
  } catch(ex) {
    if (ex.code === '23505')
      throw 'PASSCODE_ALREADY_USED';
    throw ex;
  }
}

var historySql = {

  deposits: m(function() {/*
   SELECT
     'deposit'::text AS history_type,
     user_addresses.user_id,
     json_build_object(
       'address', user_addresses.*,
       'amount', deposits.amount,
       'fee', deposits.fee,
       'txid', deposits.txid,
       'vout', deposits.vout,
       'confirmed', deposits.block_height IS NOT NULL
     ) AS payload,
     deposits.created_at
   FROM deposits
   JOIN user_addresses ON deposits.user_address_id = user_addresses.id
   JOIN users ON user_addresses.user_id = users.id
   WHERE user_addresses.user_id = $1
   ORDER BY deposits.created_at DESC
   LIMIT 100

   */}),

  withdrawals: m(function() {/*
   SELECT
     'withdrawal'::text AS history_type,
     withdrawals.user_id user_id,
     row_to_json(withdrawals) payload,
     withdrawals.created_at
   FROM withdrawals
   WHERE withdrawals.user_id = $1
   ORDER BY withdrawals.created_at DESC
   LIMIT 100
   */}),

  sends: m(function() {/*
  SELECT
     'send'::text AS history_type,
     transfers.from_user_id AS user_id,
     json_build_object(
       'to_user_uname', toUser.uname,
       'amount', transfers.amount,
       'memo', transfers.memo
     ) AS payload,
     transfers.created_at
  FROM transfers
  JOIN users toUser ON toUser.id = transfers.to_user_id
  WHERE transfers.from_user_id = $1
  ORDER BY transfers.created_at DESC
  LIMIT 100
  */}),

  receives: m(function() {/*
   SELECT
     'receive'::text AS history_type,
     transfers.to_user_id AS user_id,
     (select row_to_json(r) from (values (fromUser.uname, transfers.amount)) r(from_user_uname, amount)) AS payload,
     transfers.created_at
   FROM transfers
   JOIN users fromUser ON fromUser.id = transfers.from_user_id
   WHERE transfers.to_user_id = $1
   ORDER BY transfers.created_at DESC
   LIMIT 100
   */}),

  receive_tips: m(function() {/*
   SELECT 'receive_tip'::text AS history_type,
     toAuths.user_id,
     json_build_object(
       'tip_id', tips.id,
       'amount', tips.amount,
       'app_id', apps.id,
       'app_name', apps.name,
       'from_uname', fromUsers.uname
     ) as payload,
     tips.created_at
   FROM tips
   JOIN auths fromAuths ON fromAuths.id = tips.from_auth_id
   JOIN users fromUsers on fromUsers.id = fromAuths.user_id
   JOIN auths toAuths on toAuths.id = tips.to_auth_id
   JOIN apps ON apps.id = toAuths.app_id
   WHERE toAuths.user_id = $1
   ORDER by tips.created_at DESC
   LIMIT 100
  */}),

  send_tips: m(function() {/*
   SELECT 'send_tip'::text AS history_type,
   fromAuths.user_id,
   json_build_object(
     'tip_id', tips.id,
     'amount', tips.amount,
     'app_id', apps.id,
     'app_name', apps.name,
     'to_uname', toUsers.uname
   ) as payload,
   tips.created_at
   FROM tips
   JOIN auths fromAuths ON fromAuths.id = tips.from_auth_id
   JOIN auths toAuths on toAuths.id = tips.to_auth_id
   JOIN users toUsers on toUsers.id = toAuths.user_id
   JOIN apps ON apps.id = fromAuths.app_id
   WHERE fromAuths.user_id = $1
   ORDER by tips.created_at DESC
   LIMIT 100
   */}),

  bets: m(function() {/*
   SELECT 'bet'::text AS history_type,
     bets.user_id,
     json_build_object(
       'bet', bets,
       'app_name', apps.name,
       'app_id', apps.id
     ) AS payload,
     bets.created_at
   FROM bets
   JOIN apps ON apps.id = bets.app_id
   WHERE bets.user_id = $1
   ORDER by bets.created_at DESC
   LIMIT 100
  */}),

  faucets: m(function() {/*
   SELECT 'faucet'::text AS history_type,
    auths.user_id,
   json_build_object(
      'faucet_claim_id', faucet_claims.id,
      'amount', faucet_claims.amount,
      'app_id', apps.id,
      'app_name', apps.name
   ) as payload,
   faucet_claims.created_at
   FROM faucet_claims
   JOIN auths ON auths.id = faucet_claims.auth_id
   JOIN apps ON auths.app_id = apps.id
   WHERE auths.user_id = $1
   ORDER by faucet_claims.created_at DESC
   LIMIT 100
   */}),

  investments: m(function() {/*
    SELECT
       'investment'::text AS history_type,
       user_id AS user_id,
       json_build_object('amount', amount) AS payload,
       created_at
    FROM bankroll_events
    WHERE user_id = $1
    ORDER by created_at DESC
    LIMIT 100
  */})

};

historySql['all'] = Object.keys(historySql).map(function(key) {
  return '(' + historySql[key] + ')\n';
}).join(' UNION ALL ') + '\nORDER BY created_at DESC LIMIT 100';


exports.getUserHistory = function*(what, userId) {
  assert(_.isNumber(userId));

  var sql = historySql[what];
  assert(typeof sql === 'string');
  return (yield query(sql, [userId])).rows;
};

// For their public page, but only for admins
exports.getUserPrivateHistory = function*(userId) {
  var result = {};

  for (var key in historySql) {
    if (key === 'all') continue;
    result[key] = yield queryMany(historySql[key], [userId]);
  }

  return result;
};


// Returns addresses newest first
// Note: Uses db view "addresses_with_received"
exports.getUserAddresses = function *getUserAddresses(userId) {
  assert(_.isNumber(userId));
  var sql = m(function() {/*
   SELECT user_addresses.*,
    apps.name AS app_name,
    COALESCE(SUM(CASE WHEN deposits.block_height IS NULL THEN amount ELSE 0 END), 0) unconfirmed_received,
    COALESCE(SUM(CASE WHEN deposits.block_height IS NULL THEN 0 ELSE amount END), 0) confirmed_received
   FROM user_addresses
   LEFT JOIN deposits ON user_addresses.id = deposits.user_address_id
   LEFT JOIN auths ON auths.id = user_addresses.auth_id
   LEFT JOIN apps ON apps.id = auths.app_id
   WHERE user_addresses.user_id = $1
   GROUP BY user_addresses.id, apps.name
   ORDER BY user_addresses.id DESC
*/});
  return (yield query(sql, [userId])).rows;
};


function* generateAddress(client, userId, authId, cold, memo, auto) {
  assert(Number.isInteger(userId));
  assert(authId === null || Number.isInteger(userId));
  assert(typeof cold === 'boolean');
  assert(_.isString(memo) || _.isUndefined(memo) || _.isNull(memo));
  assert(typeof auto === 'boolean');

  var result = yield client.queryPromise("SELECT nextval('user_addresses_id_seq')");
  var id = result.rows[0].nextval;
  assert(_.isNumber(id));
  var address = belt.deriveAddress(id, cold);
  var sql = m(function() {/*
   INSERT INTO user_addresses (id, user_id, auth_id, address, cold, memo, auto)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   RETURNING *
   */});
  var results = yield client.queryPromise(sql, [id, userId, authId, address, cold, memo, auto]);
  return results.rows[0];
}

// `memo` is optional, so either pass in a string or null/undefined
exports.generateAddress = function*(userId, cold, memo) {
  return yield withClient(function*(client) {
    return yield generateAddress(client, userId, null, cold, memo, false);
  });
};

// Generates a new one, or returns an unused one
exports.getAuthDepositAddress = function*(authId, userId) {
  assert(Number.isInteger(authId));
  assert(Number.isInteger(userId));


  var sql = m(function() {/*
   SELECT address FROM user_addresses
   LEFT JOIN deposits ON deposits.user_address_id = user_addresses.id
   WHERE user_addresses.auth_id = $1 AND
         user_addresses.auto = true AND
         user_addresses.cold = false AND
         user_addresses.archived = false
   GROUP BY user_addresses.id
   HAVING COUNT(deposits.id) = 0
   ORDER BY user_addresses.id DESC
   LIMIT 1
   */});

  return yield withClient(function*(client) {
    // TODO: We should consider setting the isolation level to read-repeatability..
    //     to avoid ever double-generating an address

    var result = yield query(sql, [authId]);

    var row = (result.rows.length === 1) ?
      result.rows[0] : yield generateAddress(client, userId, authId, false, null, true);

    return row.address;
  });

};

exports.getWithdrawal = function*(id) {
  var sql = m(function() {/*
    SELECT * FROM withdrawals WHERE id = $1

  */});


  return yield queryOne(sql, [id]);

};


// Save a withdrawal in the db, and returns the withdrawal id
// Note that that client sends the withdrwalId as an argument (it's a uuid)
// and it should actually be unique or the whole thing will fail
exports.makeWithdrawal = function*(withdrawalId, fromUserId, satoshis, fee, toAddress, memo) {
  assert(typeof withdrawalId === 'string'); //uuid
  assert(_.isNumber(fromUserId));
  assert(typeof satoshis === 'number' && satoshis >= 100 * 100);
  assert(typeof fee === 'number' && fee >= 0);
  assert(belt.isValidBitcoinAddress(toAddress));
  assert(typeof memo === 'string');

  return yield withTransaction(function*(client) {

    yield decreaseUserBalance(client, fromUserId, satoshis + fee);

    var insertSql = m(function() {/*
     INSERT INTO withdrawals(id, amount, fee, user_id, to_address, status, memo)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6)
     RETURNING *
     */});

    var r;

    try {
      r = yield client.queryPromise(insertSql,
        [withdrawalId, satoshis, fee, fromUserId, toAddress, memo.length > 0 ? memo : null]);
    } catch(ex) {
      if (false) { // TODO: == unique constraint violation
        throw 'WITHDRAWAL_ID_USED';
      }
      throw ex;
    }

    return r.rows[0].id;
  });
};

exports.dequeueWithdrawal = function*(withdrawalId) {
  var sql = "UPDATE withdrawals SET status = 'in_progress' WHERE id = $1 AND status IN('failed', 'queued') RETURNING *";
  return yield queryOne(sql, [withdrawalId]);
};

exports.failWithdrawal = function*(withdrawalId) {
  var r = yield query(
    "UPDATE withdrawals SET status = 'failed' WHERE id = $1 AND status IN('in_progress', 'unknown_error')",
    [withdrawalId]);
  assert(r.rowCount === 1);
};

exports.succeedWithdrawal = function*(withdrawalId, txid) {
  assert(txid);
  yield query("UPDATE withdrawals SET status = 'success', txid = $1 WHERE id = $2", [txid, withdrawalId]);
};

exports.getUnsuccesfulTransactions = function*() {
  var sql = m(function() {/*
     SELECT users.uname, withdrawals.*
     FROM withdrawals JOIN users ON withdrawals.user_id = users.id
     WHERE withdrawals.status IN('failed', 'unknown_error')
     OR (
       withdrawals.status IN('queued', 'in_progress') AND withdrawals.created_at < NOW() - interval '1 minute'
     )
     ORDER BY withdrawals.id DESC LIMIT 100
  */});

  return yield queryMany(sql);
};


exports.transferToUser = function *(fromUserId, toUserId, satoshis, memo) {
  assert(_.isNumber(satoshis));
  assert(_.isNumber(fromUserId));
  assert(_.isNumber(toUserId));
  assert(fromUserId !== toUserId);
  assert(typeof memo === 'string');

  yield withTransaction(function*(client) {

    var increaseBalance = 'UPDATE users SET balance = balance + $1 WHERE id = $2';

    var insertSql = m(function() {/*
     INSERT INTO transfers (from_user_id, to_user_id, amount, memo)
     VALUES ($1, $2, $3, $4)
    */});

    yield [
      decreaseUserBalance(client, fromUserId, satoshis),
      client.queryPromise(increaseBalance, [satoshis, toUserId]),
      client.queryPromise(insertSql, [fromUserId, toUserId, satoshis, memo.length > 0 ? memo : null])
    ];
  });


};

exports.updateUserEmail = function *(userId, email) {
  assert(_.isNumber(userId));
  assert(_.isString(email));

  yield withTransaction(function*(client) {
    var r = yield client.queryPromise('UPDATE users SET email = $1 WHERE id = $2 RETURNING *', [email, userId]);
    assert(r.rowCount === 1);

    yield client.queryPromise(
      'UPDATE reset_tokens SET expired_at = NOW() WHERE user_id = $1 AND expired_at > NOW()', [userId]);

  });
};

exports.getAllUserInfo = function*() {
  var sql = m(function() {/*
   SELECT
     users.*,
     (
       SELECT COALESCE(SUM(deposits.amount), 0)
       FROM deposits
       JOIN user_addresses ON user_addresses.id = deposits.user_address_id
       WHERE user_addresses.user_id = users.id AND NOT user_addresses.cold
     ) AS hot_deposits,
     (
       SELECT COALESCE(SUM(deposits.amount), 0)
       FROM deposits
       JOIN user_addresses ON user_addresses.id = deposits.user_address_id
       WHERE user_addresses.user_id = users.id AND user_addresses.cold
     ) AS cold_deposits,
     (
       SELECT COALESCE(SUM(withdrawals.amount), 0)
       FROM withdrawals
       WHERE withdrawals.user_id = users.id
     ) AS withdrawals
   FROM users
   GROUP BY users.id
   ORDER BY users.id DESC
   LIMIT 500
   */});
  return yield queryMany(sql);
};

exports.getAllDepositsInfo = function*() {
  var sql = m(function() {/*
   SELECT
       deposits.id, users.uname, deposits.txid, user_addresses.address, deposits.amount, deposits.vout, user_addresses.cold,  deposits.created_at
   FROM deposits
   JOIN user_addresses ON user_addresses.id = deposits.user_address_id
   JOIN users ON users.id = user_addresses.user_id
   ORDER BY deposits.id DESC
   LIMIT 100;
 */});

  return yield queryMany(sql);
};

exports.getAllWithdrawalsInfo = function*() {
  var sql = m(function() { /*
   SELECT
     withdrawals.id, users.uname, withdrawals.to_address, withdrawals.txid, withdrawals.amount, withdrawals.created_at
   FROM withdrawals
   JOIN users ON users.id =  withdrawals.user_id
   ORDER BY withdrawals.created_at DESC
   LIMIT 100;
  */});

  return yield queryMany(sql);
};

exports.getFaucetStats = function*() {
  var sql = m(function() { /*
   SELECT
     COALESCE(SUM(amount) FILTER(WHERE created_at > NOW() - interval '1 day'), 0) AS last_day,
     COALESCE(SUM(amount) FILTER(WHERE created_at > NOW() - interval '1 week'), 0) AS last_week,
     COALESCE(SUM(amount) FILTER(WHERE created_at > NOW() - interval '1 month'), 0) AS last_month,
     COALESCE(SUM(amount), 0) AS total
   FROM
     faucet_claims
  */});

  return yield queryOne(sql);
};

exports.getAllFaucetInfo = function*() {
  var sql = m(function() { /*
   SELECT faucet_claims.*, apps.name AS app_name, users.uname FROM faucet_claims
     LEFT JOIN auths ON auths.id = faucet_claims.auth_id
     LEFT JOIN apps ON apps.id = auths.app_id
     LEFT JOIN users ON users.id = auths.user_id
   ORDER BY faucet_claims.id DESC
   LIMIT 500
  */ });

  var result = yield query(sql);
  return result.rows;
};

exports.getUsernamesByPrefix = function *(unamePrefix) {
  var sql = m(function() {/*
   WITH d AS (
     SELECT uname FROM users WHERE lower(uname)  LIKE $1 || '%' LIMIT 100
   ) SELECT array_agg(uname) AS unames FROM d;
  */});
  var row = yield queryOne(sql, [unamePrefix]);
  return row['unames'];
};

// Int -> [Session]
exports.findActiveSessions = findActiveSessions;
function *findActiveSessions(userId) {
  assert(_.isNumber(userId));
  var sql = m(function() {/*
SELECT *
FROM active_sessions
WHERE user_id = $1
ORDER BY created_at DESC
  */});
  var result = yield query(sql, [userId]);
  return result.rows;
}

// Int -> [Session]
exports.findRecentSessions = findRecentSessions;
function *findRecentSessions(userId) {
  assert(_.isNumber(userId));
  var sql = m(function() {/*
SELECT *
FROM sessions
WHERE user_id = $1 AND created_at >= (NOW() - INTERVAL '14 days')
ORDER BY created_at DESC
  */});
  var result = yield query(sql, [userId]);
  return result.rows;
}

// Int -> Base32KeyString -> MFAKey
exports.createMfaKey = createMfaKey;
function *createMfaKey(userId, secretKey) {
  assert(_.isNumber(userId));
  assert(_.isString(secretKey));
  var sql = m(function() {/*
UPDATE users
SET mfa_key = $2
WHERE id = $1
  */});
  var result = yield query(sql, [userId, secretKey]);
  return result.rows[0];
}

exports.deleteMfaKey = deleteMfaKey;
function *deleteMfaKey(userId) {
  assert(_.isNumber(userId));
  var sql = m(function() {/*
UPDATE users
SET mfa_key = null
WHERE id = $1
RETURNING *
  */});
  var result = yield query(sql, [userId]);
  return result.rows[0];
}

// Props
// - userId::Number Required
// - name::String Required
// - redirectUris::Array Optional
// - recaptchaSecret:: String|Null
exports.createApp = function*(props) {
  assert(_.isNumber(props.user_id));
  assert(_.isString(props.name));
  assert(_.isArray(props.redirect_uris) || _.isUndefined(props.redirect_uris));
  assert(_.isString(props.description));

  var sqlCreateApp = m(function() {/*
INSERT INTO apps (name, redirect_uris, secret, recaptcha_secret, description)
VALUES ($1, $2, uuid_generate_v4(), $3, $4)
RETURNING *
  */});
  var sqlCreateOwner = m(function() {/*
INSERT INTO app_staff (app_id, user_id, role)
VALUES ($1, $2, 'OWNER')
  */});

  return yield withTransaction(function*(client) {

    var app = yield queryOne(sqlCreateApp, [
      props.name,
      props.redirect_uris || [],
      props.recaptcha_secret,
      props.description
    ]);

    yield query(sqlCreateOwner, [app.id, props.user_id]);

    return app;
  });
};

exports.updateApp = function*(appId, props) {
  assert(appId);
  assert(_.isObject(props));
  var sql = m(function() {/*
UPDATE apps
SET
  name = $2,
  redirect_uris = $3,
  recaptcha_secret = $4,
  oauth_response_type = $5,
  description = $6
WHERE id = $1
RETURNING *
  */});
  var result = yield query(sql, [
    appId, props.name, props.redirect_uris || [], props.recaptcha_secret, props.oauth_response_type, props.description
  ]);
  return result.rows[0];
};

exports.findAppById = function*(id) {
  // Get everything except secret and get hash of thumb
  var sql = m(function() {/*
SELECT
  apps.id,
  apps.name,
  apps.redirect_uris,
  apps.verified_domain,
  apps.balance,
  apps.created_at,
  apps.oauth_response_type,
  apps.recaptcha_secret,
  to_json(array_remove(array_agg(active_app_staff.*), null)) app_staff,
  apps.disabled_at,
  encode(digest(thumbnail, 'sha256'), 'hex') thumbnail_hash,
  apps.description
FROM apps
LEFT OUTER JOIN active_app_staff ON apps.id = active_app_staff.app_id
WHERE apps.id = $1
GROUP BY active_app_staff.app_id, apps.id
  */});
  return yield queryOne(sql, [id]);
};

exports.getAppSecretById = function*(id) {
  var sql = 'SELECT secret FROM apps WHERE id = $1';
  var t = yield queryOne(sql, [id]);
  return t ? t.secret : 'Could not find';
};

exports.getAppIdBySecret = function*(secret) {
  var sql = 'SELECT id FROM apps WHERE secret = $1';
  return yield queryOne(sql, [secret]);
};

exports.getAuthById = function*(authId) {
  assert(Number.isInteger(authId));
  var sql = m(function() {/*
SELECT auths.*,
  to_json(apps.*) app
FROM auths
JOIN apps ON auths.app_id = apps.id
WHERE auths.id = $1
  */});
  var result = yield query(sql, [authId]);
  return result.rows[0];
};

exports.getAuthByAccessToken = function*(token) {
  var sql = m(function() { /*
   SELECT auths.*
   FROM auths
   JOIN tokens ON tokens.auth_id = auths.id
   WHERE tokens.token = $1
     AND tokens.expired_at > NOW()
     AND tokens.kind = 'access_token'
 */});

  return yield queryOne(sql, [token]);
};

exports.findAuthForUserIdAndAppId = function*(userId, appId) {
  var sql = m(function() {/*
SELECT *
FROM auths WHERE user_id = $1 AND app_id = $2
  */});
  return yield queryOne(sql, [userId, appId]);
};

exports.findAuthByIdAndAppSecret = function*(authId, appSecret) {
	var sql = m(function() {/*
		SELECT auths.* FROM auths
		JOIN apps ON apps.id = auths.app_id
		WHERE auths.id = $1
		AND apps.secret = $2
	*/});

	return yield queryOne(sql, [authId, appSecret]);
};


exports.findAuthAndUnameByIdAndAppSecret = function*(authId, appSecret) {
  var sql = m(function() {/*
   SELECT auths.*, users.uname FROM auths
   JOIN apps ON apps.id = auths.app_id
   JOIN users ON users.id = auths.user_id
   WHERE auths.id = $1
   AND apps.secret = $2
   */});

  return yield queryOne(sql, [authId, appSecret]);
};


// isEnabled: Boolean, defaults to false (i.e. by default, auths are created
//            in the disabled state)
exports.createAuth = function*(userId, appId, amount, isEnabled) {
  assert(Number.isFinite(userId));
  assert(Number.isFinite(appId));
  assert(Number.isFinite(amount));

  var sql = m(function() {/*
INSERT INTO auths (user_id, app_id, enabled)
VALUES ($1, $2, $3)
RETURNING *
  */});

  return yield withTransaction(function*(client) {
    // Create app authorization
    var result;
    try {
      result = yield client.queryPromise(sql, [userId, appId, !!isEnabled]);
    } catch (ex) {
      if (ex.code === '23505') // Constraint Violation
        throw 'AUTH_ALREADY_EXISTS';
      throw ex;
    }
    var auth = result.rows[0];
    assert(auth);

    if (amount !== 0)
      yield doFundAuth(client, userId, auth.id, amount);

    return auth;
  });
};


exports.findAuthsAndAppsByUserId = function*(userId) {
  debug('[findAuthsAndAppsByUserId] userId:', userId);

  var sql = m(function() {/*
SELECT
  auths.*,
  json_build_object(
    'id', apps.id,
    'name', apps.name,
    'verified_domain', apps.verified_domain,
    'created_at', apps.created_at,
    'disabled_at', apps.disabled_at,
    'thumbnail_hash', encode(digest(thumbnail, 'sha256'), 'hex')
  ) "app",
  EXISTS (
    SELECT *
    FROM active_app_staff
    WHERE
      app_id = apps.id
      AND user_id = $1
  ) is_staff
FROM auths
JOIN apps ON auths.app_id = apps.id
WHERE auths.user_id = $1
  */});

  return yield queryMany(sql, [userId]);
};

exports.getRecaptchaSecretFromAuthId = function*(authId) {
  assert(Number.isInteger(authId) && authId > 0);

  var sql = m(function() { /*
   SELECT apps.recaptcha_secret FROM apps
    JOIN auths ON auths.app_id = apps.id
    WHERE auths.id = $1
  */ });

  var r = yield queryOne(sql, [authId]);

  if (!r)
    throw 'INVALID_AUTH_ID';

  if (!r.recaptcha_secret)
    throw 'NO_CONFIGURED_RECAPTCHA_SECRET';

  return r.recaptcha_secret;
};

// returns the claim id
exports.claimFaucet = function*(authId, amount, ip) {
  assert(Number.isInteger(authId) && authId > 0);
  assert(Number.isFinite(amount) && amount > 0);
  assert(typeof ip === 'string' && ip.length > 0); // TODO: there's an ip validator

  try {
    return yield withTransaction(function*(client) {
      var r = yield client.queryPromise('INSERT INTO faucet_claims(auth_id, amount, ip_address) VALUES($1,$2,$3) RETURNING id;', [authId, amount, ip]);
      if (r.rowCount !== 1) {
        throw new Error('Could not insert into faucet claims for auth: ' + authId);
      }
      var claimId = r.rows[0].id;
      assert(Number.isInteger(claimId));

      r = yield client.queryPromise('UPDATE auths SET balance = balance + $1 WHERE id = $2', [amount, authId]);
      if (r.rowCount !== 1) {
        throw new Error('Could not update auths balance for id = ' + authId);
      }

      return claimId;
    });

  } catch (ex) {
    if (ex.code === '23505') // Constraint Violation
      throw 'FAUCET_ALREADY_CLAIMED';
    throw ex;
  }

};


exports.getBankroll = function*() {
  var r = yield query('SELECT * FROM bankroll');
  assert(r.rows.length === 1);
  assert(typeof r.rows[0].balance === 'number');
  return r.rows[0];
};

exports.getUsersBankrollStake = function*(userId) {
  var sql = 'SELECT stake FROM bankroll_stakes WHERE user_id = $1';
  var r = yield query(sql, [userId]);

  if (r.rows.length === 0)
    return 0;

  assert(r.rows.length === 1);
  return r.rows[0].stake;
};


exports.invest = function*(userId, satoshis) {
  assert(typeof userId === 'number');
  assert(typeof satoshis === 'number' && satoshis >= 1);

  try {
    yield query('SELECT invest($1, $2)', [userId, satoshis]);
  } catch (ex) {
    if (ex.message === 'NOT_ENOUGH_BALANCE')
      throw 'NOT_ENOUGH_BALANCE';
    throw ex;
  }

};

exports.divest = function*(userId, satoshis) {
  assert(Number.isInteger(userId) && userId > 0);
  assert(Number.isFinite(satoshis) && satoshis >= 1);
  try {
    yield query('SELECT divest($1, $2)', [userId, satoshis]);
  } catch (ex) {
    if (ex.message === 'NOT_ENOUGH_BALANCE')
      throw 'NOT_ENOUGH_BALANCE';
    throw ex;
  }

};

exports.divestAll = function*(userId) {
  assert(Number.isInteger(userId) && userId > 0);
  try {
    yield query('SELECT divest_all($1)', [userId]);
  } catch (ex) {
    if (ex.message === 'NOT_ENOUGH_BALANCE')
      throw 'NOT_ENOUGH_BALANCE';
    throw ex;
  }
};

exports.getProofOfLiabilities = function*() {
  return (yield query('SELECT hash, balance, invested, in_apps FROM proof_of_liabilities')).rows;
};

exports.getUsersProofOfLiability = function*(userId) {
  return (yield query('SELECT * FROM proof_of_liabilities WHERE user_id = $1', [userId])).rows[0];
};

exports.genBetHash = function*(authId) {
  assert(Number.isInteger(authId) && authId > 0);

  var sql = m(function() {/*
   INSERT INTO bet_hashes(auth_id, secret, salt)
     SELECT $1, $2, gen_random_bytes(16)
   RETURNING make_hash(secret, salt)
  */});

  var v = Number.parseInt((yield crypto.randomBytes(4)).toString('hex'), 16);

  var r = yield query(sql, [authId, v]);
  if (r.rowCount === 0)
    throw new Error('Could not insert into bet hashes');

  assert(r.rows.length === 1);
  var hash = r.rows[0].make_hash;
  assert(typeof hash === 'string');
  return hash;
};

exports.createLocks = function*(appSecret, meta, locks) {
  throw new Error('TODO');
  assert(belt.isValidUuid(appSecret));
  assert(Array.isArray(locks));

  var totalLocked = 0;
  var appAuthIds = [];
  var appAuthAmounts = [];

  for (var lock in locks) {
    var a = lock['amount'];
    assert(Number.isFinite(a) && a > 0);

    totalLocked += a;
    appAuthAmounts.push(a);

    var id = lock['user_id'];
    assert(Number.isInteger(id) && id > 0);
    appAuthIds.push(a);
  }
  assert(appAuthIds.length > 0);
  assert(appAuthIds.length === appAuthAmounts);


  return yield withTransaction(function*(client) {
    var r = yield client.queryPromise('UPDATE apps SET balance=balance+$1 WHERE secret = $2 RETURNING id', [totalLocked, appSecret]);
    if (r.rowCount !== 1)
      throw 'INVALID_APP_SECRET';

    var appId = r.rows[0].id;
    assert(Number.isInteger(appId) && appId > 0);

    var sql = m(function() {/*
       UPDATE auths SET budget_used = budget_used + ss.amount
       FROM (SELECT unnest($1) as auth_id, unnest($2) as amount) ss
       WHERE id = ss.auth_id
       AND app_id = $3
       AND enabled = true
       RETURNING user_id, amount
    */});

    r = yield client.queryPromise(sql, [appAuthIds, appAuthAmounts, appId]);

    if (r.rowCount !== appAuthIds.length) {
       assert(r.rowCount < appAuthIds.length);
       throw new Error('COULD_NOT_LOCK');
    }

    var userIds = [];
    var userAmounts = [];

    for (var r in r.rows) {
      var userId = r['user_id'];
      assert(Number.isInteger(userId) && userId > 0);
      userId.push(r);
      var amount = r['amount'];
      assert(Number.isFinite(amount) && amount > 0);
      userAmounts.push(userAmounts);
    }
    assert(userIds.length > 0);
    assert(userIds.length === userAmounts.length);

    var uSql = m(function() { /*
       UPDATE users SET balance = balance - ss.amount
       FROM (SELECT unnest($1) as username, SELECT unnest($2) as amount)
       WHERE id = ss.user_id AND balance > 0
     */ });

    r = yield client.queryPromise(uSql, [userIds, userAmounts]);

    if (r.rowCount !== userIds.length) {
      assert(r.rowCount < userIds.length);
      throw 'COULD_NOT_LOCK';
    }

    var metas = []; // meta repeated for each arbitration
    for (var i = 0; i < appAuthIds.length; ++i) {
      metas.push(meta.length === 0 ? null : meta);
    }
    assert(metas.length === appAuthIds.length);

    var arbSql = m(function() { /*
     INSERT INTO arbitrations(auth_id, stake, meta)
     SELECT unnest($1), unnest($2), unnest($3);
    */ });


    r = yield client.queryPromise(arbSql, [appAuthIds, appAuthAmounts, metas]);

    assert(r.rowCount === appAuthIds.length);
  });

};

// resolutions is [ { user_id, resolution} ]
exports.resolve = function*(appSecret, resolutions) {
  assert(belt.isValidUuid(appSecret));
  assert(resolutions.length > 0);
};


// Creates and returns an token
exports.createToken = function*(authId, kind) {
  assert(Number.isInteger(authId));
  assert(kind === 'confidential_token' || kind === 'access_token');
  var sql = m(function() {/*
INSERT INTO tokens (token, auth_id, kind, expired_at)
VALUES (uuid_generate_v4(), $1, $2, NOW() + '2 weeks'::interval)
RETURNING *
  */});

  return yield queryOne(sql, [authId, kind]);
};


exports.getAccessTokenInformation = function*(token) {
  var sql = m(function() {/*
SELECT
  to_json(tokens.*) access_token,
  to_json(auths.*) auth,
  users.uname
FROM tokens
JOIN auths ON auths.id = tokens.auth_id
JOIN users ON users.id = auths.user_id
WHERE tokens.token = $1 AND tokens.kind = 'access_token'
      AND tokens.expired_at > NOW()
  */});
  return yield queryOne(sql, [token]);
};

exports.getTokenInformation = function*(token) {
  var sql = m(function() {/*
   SELECT
     to_json(tokens.*) AS token,
     to_json(auths.*) AS auth,
     json_build_object(
       'uname', users.uname,
       'role', users.role
     ) AS user
   FROM tokens
   JOIN auths ON auths.id = tokens.auth_id
   JOIN users ON users.id = auths.user_id
   WHERE tokens.token = $1
   AND tokens.expired_at > NOW()
  */});
  return yield queryOne(sql, [token]);
};

// Same as above, just for hashed tokens
exports.getHashedTokenInformation = function*(token) {
  var sql = m(function() {/*
   SELECT
   to_json(tokens.*) token,
   to_json(auths.*) auth,
   json_build_object(
      'uname', users.uname,
      'role', users.role
   ) AS user
   FROM tokens
   JOIN auths ON auths.id = tokens.auth_id
   JOIN users ON users.id = auths.user_id
   WHERE encode(digest(tokens.token::text, 'sha256'), 'hex') = $1
   AND tokens.expired_at > NOW()
   */});
  return yield queryOne(sql, [token]);
};

exports.getHashedTokenInformationDeprecated = function*(hashedToken) {
  var sql = m(function() {/*
   SELECT users.id,
      users.uname,
      users.role
   FROM tokens
   JOIN auths ON auths.id = tokens.auth_id
   JOIN users ON users.id = auths.user_id
   WHERE encode(digest(tokens.token::text, 'sha256'), 'hex') = $1
   AND tokens.expired_at > NOW()
  */});


  var result = yield query(sql, [hashedToken]);
  return result.rows[0];
};


exports.fundApp = function*(userId, appId, satoshis) {
  assert(Number.isInteger(userId));
  assert(Number.isInteger(appId));
  assert(Number.isInteger(satoshis));

  yield withTransaction(function*(client) {

    var insert = client.queryPromise(m(function() {/*
INSERT INTO app_fundings (app_id, user_id, amount)
VALUES ($1, $2, $3)
    */}), [appId, userId, satoshis]);

    // 2. Update users.balance

    // Just because someone has a negative balance, shouldn't stop them from withdrawing from the app..
    var updateUsers = client.queryPromise(m(function() { /*
    UPDATE users
      SET balance = balance - $1
     WHERE id = $2 AND (CASE WHEN $1 > 0 THEN balance >= $1 ELSE true END)
    */ }),
      [satoshis, userId]);

    // 3. Update apps.balance

    var updateApp = client.queryPromise(m(function() {/*
UPDATE apps
SET balance = balance + $1
WHERE id = $2 AND (CASE WHEN $1 < 0 THEN balance >= -$1 ELSE true END)
    */}), [satoshis, appId]);

    var results = yield [insert, updateUsers, updateApp];

    assert(results[0].rowCount === 1);

    if (results[1].rowCount !== 1)
      throw 'NOT_ENOUGH_BALANCE';

    if (results[2].rowCount !== 1)
      throw 'NOT_ENOUGH_BALANCE';

  });
};


// This is very very similiar to funding an app, with minor differences
// due to an auth_funding doesn't have a user_id
//
// Returns undefined
function* doFundAuth(client, userId, authId, satoshis) {
  assert(client);
  assert(Number.isInteger(userId));
  assert(Number.isInteger(authId));
  assert(Number.isInteger(satoshis));

  var insertFunding = client.queryPromise(m(function() {/*
   INSERT INTO auth_fundings (auth_id, amount)
   VALUES ($1, $2)
   */}), [authId, satoshis]);


  // Just because someone has a negative balance, shouldn't stop them from withdrawing from the auth..
  var updateUser = client.queryPromise(m(function() { /*
     UPDATE users
     SET balance = balance - $1
     WHERE id = $2 AND (CASE WHEN $1 > 0 THEN balance >= $1 ELSE true END)
     */ }),
    [satoshis, userId]);

  // 3. Update auths.balance

  // Note: this returns the updated auth record
  var updateAuth = client.queryPromise(m(function() {/*
   UPDATE auths
   SET balance = balance + $1
   WHERE id = $2 AND (CASE WHEN $1 < 0 THEN balance >= -$1 ELSE true END)
   RETURNING *
   */}), [satoshis, authId]);

  var results = yield {
    insertFunding: insertFunding,
    updateUser: updateUser,
    updateAuth: updateAuth
  };

  assert(results.insertFunding.rowCount === 1);

  if (results.updateUser.rowCount !== 1)
    throw 'NOT_ENOUGH_BALANCE';

  if (results.updateAuth.rowCount !== 1)
    throw 'NOT_ENOUGH_BALANCE';

  // Now send 'balance_change' notification
  //
  // Note: Keep in sync with the payload/notifications in
  // the deposits_trigger in schema.sql

  let updatedAuth = results.updateAuth.rows[0];

  let notifyPayload = {
    auth_id: updatedAuth.id,
    user_id: updatedAuth.user_id,
    app_id:  updatedAuth.app_id,
    diff:    satoshis,
    balance: updatedAuth.balance
  };

  yield client.queryPromise(
    "SELECT pg_notify('balance_change', $1)",
    [JSON.stringify(notifyPayload)]
  );

}


// Move money from user to their auth.balance
// Reminder: This is additive. It does not set `auth.balance = satoshis`,
//           but rather `auth.balance += satoshis`.
exports.fundAuth = function*(userId, authId, satoshis) {
  debug('[fundAuth] userId: %s, authId: %s, satoshis: %s',
        userId, authId, satoshis);

  assert(Number.isInteger(userId));
  assert(Number.isInteger(authId));
  assert(Number.isInteger(satoshis));

  yield withTransaction(function*(client) {
    yield doFundAuth(client, userId, authId, satoshis);
  });
};

exports.appHistory = function*(appId) {
  var sql = m(function() {/*
    SELECT
      bets.*,
      json_build_object(
        'id', users.id,
        'uname', users.uname
      ) "user"
    FROM bets
    JOIN  users ON bets.user_id = users.id
    WHERE bets.app_id = $1
    ORDER BY (bets.id+0) DESC
    LIMIT 100
  */});

  var results = yield query(sql, [appId]);

  return results.rows;
};

exports.appStats = function*(appId) {
  var sql = m(function() { /*
    SELECT
      COALESCE(SUM(betted_count)::bigint, 0) bets,
      COALESCE(SUM(betted_wager), 0)         wagered,
      COALESCE(-SUM(betted_ev), 0)           ev,
      COALESCE(-SUM(betted_profit), 0)       profit
    FROM auths WHERE app_id = $1
  */ });

  return yield queryOne(sql, [appId]);
};

exports.invalidateAppSecret = function*(appId) {
  assert(Number.isInteger(appId) && appId > 0);

  var sql = 'UPDATE apps SET secret = uuid_generate_v4() WHERE id = $1';
  var result = yield query(sql, [appId]);

  if (result.rowCount !== 1)
    throw new Error('Could not update app secret for app ' + appId);
};

// This only selects the uname of the users, to avoid accidentally
// leaking any information
exports.getPublicBetInfo = function*(id) {
  var sql = m(function() {/*
SELECT
  b.*,
  json_build_object('uname', u.uname) "user",
  json_build_object('id', apps.id, 'name', apps.name) "app"
FROM bets b
JOIN auths aa ON b.auth_id = aa.id
JOIN apps ON aa.app_id = apps.id
JOIN users u ON aa.user_id = u.id
WHERE b.id = $1
  */});
  var result = yield query(sql, [id]);
  return result.rows[0];
};

exports.getPublicBets = function*(appId, greaterThan, lessThan, orderBy, limit) {
  assert(Number.isInteger(appId));
  assert(!greaterThan || Number.isInteger(greaterThan));
  assert(!lessThan || Number.isInteger(lessThan));
  assert(orderBy === 'asc' || orderBy === 'desc');
  assert(Number.isInteger(limit));

  var sql = m(function() { /*
   SELECT
      bets.id, bets.kind, bets.wager,
      (bets.client_seed + bets.secret) % 4294967296 raw_output, bets.profit, bets.payouts,
      users.uname, bets.created_at
   FROM
   bets
   JOIN users ON users.id = bets.user_id
   WHERE bets.app_id = $1
   AND (CASE WHEN $2::int8 IS NOT NULL THEN bets.id > $2 ELSE true END)
   AND (CASE WHEN $3::int8 IS NOT NULL THEN bets.id < $3 ELSE true END)
   ORDER BY bets.id $$DIRECTION$$
   LIMIT $4;
  */ }).replace('$$DIRECTION$$', orderBy === 'asc' ? 'ASC' : 'DESC');

  return yield queryMany(sql, [appId, greaterThan, lessThan, limit]);
};


exports.getPublicAuthInfoByUname = function*(uname, appId) {
  var sql = m(function() {/*
    SELECT
      users.uname,
      auths.betted_count - auths.reset_betted_count AS betted_count,
      auths.betted_wager - auths.reset_betted_wager AS betted_wager,
      auths.betted_ev - auths.reset_betted_ev AS betted_ev,
      auths.betted_profit - auths.reset_betted_profit AS betted_profit
    FROM auths
    JOIN users ON users.id = auths.user_id
    WHERE app_id = $1
      AND lower(users.uname) = lower($2)
  */});

  return yield queryOne(sql, [appId, uname]);
};


// For use in displaying public app list to users
// TODO: Pagination and filters
exports.findAllApps = function*() {
  var sql = m(function() {/*
SELECT a.*
FROM apps a
ORDER BY lower(a.name)
LIMIT 100
  */});
  var result = yield query(sql);
  return result.rows;
};

exports.enableAuth = function*(authId) {
  assert(Number.isInteger(authId));
  var sql = m(function(){ /*
    UPDATE auths SET enabled=true WHERE id = $1 AND EXISTS(
       SELECT 1 FROM apps WHERE id = app_id AND disabled_at IS NULL
    )
   */});

  var r = yield query(sql, [authId]);
  return r.rowCount === 1;
};

exports.disableAuth = function*(authId) {
  assert(Number.isInteger(authId));
  var sql = 'UPDATE auths SET enabled=false WHERE id = $1';

  var r = yield query(sql, [authId]);
  assert(r.rowCount === 1);
  return;
};


////////////////////////////////////////////////////////////

exports.createLoginAttempt = function*(props) {
  var sql = m(function() {/*
INSERT INTO login_attempts (user_id, user_agent, ip_address, is_success)
VALUES ($1, $2, $3, $4)
RETURNING *
  */});
  var result = yield query(sql, [
    props.user_id,
    props.user_agent,
    props.ip_address,
    props.is_success
  ]);
  return result.rows[0];
};

exports.findUserFromLoginAttemptId = function*(loginAttemptId) {
	assert(belt.isValidUuid(loginAttemptId));

	var sql = m(function() {/*
		SELECT * FROM users
		WHERE id = (
			SELECT user_id FROM login_attempts WHERE id = $1
		)
	*/});
	return yield queryOne(sql, [loginAttemptId]);
};

exports.createMfaAttempt = function*(props) {
  var sql = m(function() {/*
INSERT INTO mfa_attempts (login_attempt_id, is_success)
VALUES ($1, $2)
RETURNING *
  */});
  var result = yield query(sql, [
    props.login_attempt_id,
    props.is_success
  ]);
  return result.rows[0];
};

// TODO:  remove time interval, and use since last successful mfa
exports.shouldLockUser = function*(userId) {
  var sql = m(function() {/*
SELECT COUNT(ma) >= 5 AS should_lock
FROM mfa_attempts ma
JOIN login_attempts la ON ma.login_attempt_id = la.id
WHERE
  ma.created_at > NOW() - interval '30 seconds'
  AND ma.is_success = false
  AND la.user_id = $1
  */});
  var result = yield query(sql, [userId]);

  var sl = result.rows[0].should_lock;
  assert(typeof sl == 'boolean');
  return sl;
};

exports.lockUser = function*(userId) {
  yield query('UPDATE users SET locked_at = NOW() WHERE id = $1', [userId]);
};

// Run by cronjob (cron/refresh-proof-of-liabilities.js)
exports.refreshProofOfLiabilities = function*() {
  var sql = m(function() {/*
REFRESH MATERIALIZED VIEW CONCURRENTLY proof_of_liabilities
  */});
  yield query(sql);
};

exports.findAdminUsers = function*() {
  var sql = m(function() {/*
SELECT *
FROM users
WHERE role = 'admin'
ORDER BY uname
  */});
  return yield queryMany(sql);
};

exports.findStaffedAppsWithAuthForUserId = function*(userId) {
  assert(typeof userId === 'number');
  var sql = m(function() {/*
SELECT
   json_build_object(
     'id', apps.id,
     'name', apps.name,
     'verified_domain', apps.verified_domain,
     'created_at', apps.created_at,
     'disabled_at', apps.disabled_at,
     'thumbnail_hash', encode(digest(thumbnail, 'sha256'), 'hex'),
     'balance', apps.balance
   ) AS app,
  to_json(auths.*) auth,
  active_app_staff.role "role"
FROM apps
LEFT OUTER JOIN auths ON apps.id = auths.app_id
  AND auths.user_id = $1
JOIN active_app_staff ON apps.id = active_app_staff.app_id
  AND active_app_staff.user_id = $1
ORDER BY apps.id
  */});
  var result = yield query(sql, [userId]);
  return result.rows;
};

exports.tipToUname = function*(authId, appId, toUname, amount) {
  assert(Number.isInteger(authId) && authId > 0);
  assert(Number.isInteger(appId) && appId > 0);
  assert(typeof toUname === 'string' && toUname.length > 0);

  return yield withTransaction(function*(client) {
    var r = yield client.queryPromise(
      'UPDATE auths SET balance = balance - $1 WHERE balance >= $1 AND id = $2', [amount, authId]);

    if (r.rowCount !== 1)
      throw 'NOT_ENOUGH_BALANCE';

    var updateSql = m(function() { /*
       UPDATE auths
       SET balance = balance + $1
       WHERE user_id = (
         SELECT id FROM users WHERE lower(uname) = lower($2)
       ) AND app_id = $3
       RETURNING id
       */
      });

    var u = yield client.queryPromise(updateSql, [amount, toUname, appId]);

    if (u.rowCount !== 1)
      throw 'UNAME_NOT_FOUND';

    var toAuthId = u.rows[0].id;
    assert(Number.isInteger(toAuthId) && toAuthId > 0);


    var i = yield client.queryPromise(
      'INSERT INTO tips(from_auth_id, to_auth_id, amount) VALUES($1, $2, $3) RETURNING *',
      [authId, toAuthId, amount]
    );

    assert(i.rowCount === 1);

    return i.rows[0];
  });

};

////////////////////////////////////////////////////////////

exports.getLatestActiveBannerAnnouncement = function*() {
  var sql = m(function() {/*
SELECT *
FROM banner_announcements
WHERE is_active = true
ORDER BY id desc
LIMIT 1
  */});

  var result = yield query(sql);
  return result.rows[0];
};

exports.insertBannerAnnouncement = function*(html, type) {
  var sql = m(function() {/*
INSERT INTO banner_announcements (html, type, is_active)
VALUES ($1, $2, true)
  */});

  var result = yield query(sql, [html, type]);
  return result.rows[0];
};

exports.clearBannerAnnouncement = function*() {
  var sql = m(function() {/*
UPDATE banner_announcements
SET is_active = false
WHERE is_active = true
  */});

  yield query(sql);
};

////////////////////////////////////////////////////////////

exports.getDemotedStaffForAppId = function*(app_id) {
  assert(_.isNumber(app_id));

  var sql = m(function() {/*
SELECT
  demoted_app_staff.*,
  users.uname,
  to_json(u2.*) "appointed_by_user",
  to_json(u3.*) "demoted_by_user"
FROM demoted_app_staff
JOIN users ON demoted_app_staff.user_id = users.id
LEFT OUTER JOIN users u2 ON demoted_app_staff.appointed_by_user_id = u2.id
JOIN users u3 ON demoted_app_staff.demoted_by_user_id = u3.id
WHERE demoted_app_staff.app_id = $1
ORDER BY demoted_app_staff.demoted_at DESC
LIMIT 50
  */});

  return yield queryMany(sql, [app_id]);
};

exports.getActiveStaffForAppId = function*(app_id) {
  assert(_.isNumber(app_id));

  var sql = m(function() {/*
SELECT
  active_app_staff.*,
  users.uname,
  to_json(u2.*) "appointed_by_user"
FROM active_app_staff
JOIN users ON active_app_staff.user_id = users.id
LEFT OUTER JOIN users u2 ON active_app_staff.appointed_by_user_id = u2.id
WHERE active_app_staff.app_id = $1
  */});

  return yield queryMany(sql, [app_id]);
};

// data: {
//  app_id:               Int
//  role:                 String 'OWNER' | 'MOD'
//  appointed_by_user_id: Int
//  user_id:              Int
//}
exports.insertAppStaff = function*(data) {
  assert(_.isNumber(data.app_id));
  assert(_.isNumber(data.user_id));
  assert(_.isNumber(data.appointed_by_user_id));
  assert(_.isString(data.role) || _.contains(['OWNER', 'MOD'], data.role));

  var sql = m(function() {/*
INSERT INTO app_staff (app_id, user_id, appointed_by_user_id, role)
VALUES ($1, $2, $3, $4)
RETURNING *
  */});

  return yield queryOne(sql, [
    data.app_id,
    data.user_id,
    data.appointed_by_user_id,
    data.role
  ]);
};

// data: {
//  app_id:               Int
//  demoted_by_user_id:   Int
//  user_id:              Int
//}
exports.demoteAppStaff = function*(data) {
  assert(Number.isInteger(data.app_id));
  assert(Number.isInteger(data.user_id));
  assert(Number.isInteger(data.demoted_by_user_id));

  var sql = m(function() {/*
UPDATE app_staff
SET
  demoted_at = NOW(),
  demoted_by_user_id = $3
WHERE
  app_id = $1
  AND user_id = $2
  */});

  return yield query(sql, [
    data.app_id,
    data.user_id,
    data.demoted_by_user_id
  ]);
};

exports.findFundingsForAppId = function*(app_id) {
  assert(Number.isInteger(app_id));

  var sql = m(function() {/*
SELECT
  app_fundings.*,
  users.uname uname
FROM app_fundings
JOIN users ON app_fundings.user_id = users.id
WHERE app_fundings.app_id = $1
ORDER BY app_fundings.id DESC
LIMIT 50
  */});

  return yield queryMany(sql, [app_id]);
};

// Copy and pasted into MP api
exports.disableApp = function*(appId) {
  var r = yield query('UPDATE apps SET disabled_at = NOW() WHERE id = $1', [appId]);
  assert(r.rowCount === 1);
  yield query('UPDATE auths SET enabled=false WHERE app_id = $1', [appId]);

  yield query('UPDATE tokens SET expired_at = NOW() WHERE auth_id IN (SELECT id FROM auths WHERE app_id = $1) AND expired_at > NOW()', [appId]);
};

exports.updateAppThumbnail = function*(appId, thumbBuffer) {
  var r = yield query('UPDATE apps SET thumbnail = $1 WHERE id = $2', [thumbBuffer, appId]);
  assert(r.rowCount === 1);
};

exports.getAppThumbnailByHash = function*(hash) {
  var r = yield queryOne("SELECT thumbnail FROM apps WHERE encode(digest(thumbnail, 'sha256'), 'hex') = $1 LIMIT 1", [hash]);
  return r ? r.thumbnail : null;
};

// Returns integer
//
// Since COUNT(*) is going to take minutes, just grab MAX(id)
exports.getBetsCount = function*() {
  var sql = 'SELECT MAX(id) AS count FROM bets';
  var result = yield queryOne(sql);
  return result.count || 0;
};

////////////////////////////////////////////////////////////

// Returns lockout or null
exports.getActiveLockoutForUserId = function*(user_id) {
  var sql = m(function() {/*
    SELECT *
    FROM active_divestment_lockouts
    WHERE user_id = $1
  */});

  return yield queryOne(sql, [user_id]);
};

// Returns inserted lockout
// Or throws 'ALREADY_LOCKED_OUT' if they've already an active one
//
// user_id: Required Int
// days:    Required Int
exports.insertDivestmentLockout = function*(user_id, days) {
  assert(Number.isInteger(user_id));
  assert(Number.isInteger(days));

  var getActiveLockout = m(function() {/*
    SELECT id
    FROM active_divestment_lockouts
    WHERE user_id = $1
  */});

  var insertLockout = m(function() {/*
    INSERT INTO divestment_lockouts (user_id, expired_at)
    VALUES ($1, NOW() + $2::interval)
    RETURNING *
  */});

  return yield withTransaction(function*(client) {
    // Ensure user doesn't already have an active lockout

    let result1 = yield client.queryPromise(getActiveLockout, [user_id]);

    if (result1.rows.length > 0) {
      throw 'ALREADY_LOCKED_OUT';
    }

    let result2 = yield client.queryPromise(insertLockout, [user_id, days.toString() + ' days']);
    let lockout = result2.rows[0];

    return lockout;
  });
};

////////////////////////////////////////////////////////////

// domain should be string or null
exports.updateAppVerifiedDomain = function*(app_id, domain) {
  assert(Number.isInteger(app_id));
  assert(_.isNull(domain) || _.isString(domain));

  var sql = m(function() {/*
UPDATE apps
SET verified_domain = $2
WHERE id = $1
  */});

  return yield query(sql, [app_id, domain]);
};


exports.getPublicAppsStats = function*() {
  var sql = m(function() {/*
   SELECT
     apps.id,
     apps.name,
     apps.description,
     encode(digest(thumbnail, 'sha256'), 'hex') thumbnail,
     SUM(betted_count)::bigint AS bets,
     SUM(betted_wager) AS wagered,
     -SUM(betted_ev) AS ev,
     -SUM(betted_profit) as profit,
     (SELECT SUM(amount)*-1 FROM app_fundings WHERE app_fundings.app_id = apps.id)+apps.balance app_comissions
   FROM apps
   JOIN auths ON auths.app_id = apps.id
   WHERE apps.verified_domain IS NOT null
   GROUP BY apps.id
   ORDER BY ev DESC
  */});

  return yield queryMany(sql);
};

////////////////////////////////////////////////////////////

// `interval` must be Postgres interval string.
exports.countNewUsersSince = function*(interval) {
  assert(_.isString(interval));

  var sql = m(function() {/*
SELECT count(*) AS count
FROM users
WHERE created_at > NOW() - $1::interval
  */});

  var result = yield queryOne(sql, [interval]);
  return result.count;
};

exports.getNextHotWalletSpillSequence = function*() {
  var sql = "SELECT nextval('hot_wallet_spill_seq')";
  var n = (yield queryOne(sql)).nextval;
  assert(Number.isInteger(n));
  return n;
};
