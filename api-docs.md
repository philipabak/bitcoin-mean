FORMAT: 1A
HOST: https://api.moneypot.com

# MoneyPot API

- Homepage: <https://www.moneypot.com>
- Latest API version: `v1`
- API Endpoint: `https://api.moneypot.com`

For any support or account issues please use our [support](/support) form, or for any general conversation and questions
we use slack. Enter your email on https://slack.moneypot.com to be sent an invitation to our group.



**These API docs are a work in progress under active development.**


# Group Creating an App/Casino

To begin integrating with our API, you must first [create an app](https://www.moneypot.com/apps/new).

Note: Feel free to create one just to play around with. We only add apps to our [list of apps](https://www.moneypot.com/apps) once you ask us to review and approve it.



# Group Authentication

MoneyPot uses a modified OAuth 2.0 system for authentication.


## Client Side Apps  [/client-side-apps]

Client-side apps are apps where the users browser is directly communicating with MoneyPot's server. This workflow is known
as "implicit" in the OAuth terminology. Apps using this flow, should set the `response_type` to `token` in the app's settings panel.

For a user to be logged in and make API calls they require an unexpired `access_token`. Login is achieved by sending the user to:

    https://www.moneypot.com/oauth/authorize?app_id=<YOUR_APP_ID>&response_type=token&state=<RANDOM_STRING>&redirect_uri=<REDIRECT_URI>

and after they login, they will be redirected to your redirect URI:

    <YOUR_REDIRECT_URI>#access_token=xxxx-xxxx-xxxx-xxxx&expires_in=<SECONDS>&state=<RANDOM_STRING>
    (The data is sent as hash parameters for your javascript app to process)

Access tokens typically expire in around 2 weeks.

Note: All redirect_uri's must be whitelisted in your app's setting page.

Important: The reason why the `implicit` flow uses hash fragments (`#`) is that the information is never transmitted to
the server of <YOUR_REDIRECT_URI> but only the users browser. It is recommended that you parse out the`access_token` and `expires_in`
and save to localStorage, and then strip it from the URL.

## Server Side Apps  [/client-side-apps]

Server-Side apps allow you to make API requests on a users behalf, rather than the the user making them themselves.
This allows you much more control and flexibility, at the cost of maintaining your own server. This flow is known as the `confidential`
flow.

Apps using this flow, should set the `response_type` to `confidential` in the app's settings panel.


This flow does not use `access_token`s but rather uses your `app_secret` in API requests. First the user must login, and give permissions
to your app. To do this you should send them to:


    https://www.moneypot.com/oauth/authorize?app_id=<YOUR_APP_ID>&response_type=confidential&state=<RANDOM_STRING>&redirect_uri=<REDIRECT_URI>

and after they login, they will be redirected to your redirect URI:

    <YOUR_REDIRECT_URI>?confidential_token=xxxx-xxxx-xxxx-xxxx&state=<RANDOM_STRING>
    (The data is sent as a query string for your server to process process)

The confidential token expires in a short amount of time (typically a couple minutes) and is not intended for reuse or storing. You should use the confidential token (And your app_secret) to get the users `auth_id`

## Redirect user to authorize page [/oauth/authorize]

### GET

This is not an API endpoint but rather an endpoint you must redirect a user to.

+ Parameters

    + app_id (required, integer)
    + response_type (required, string) ...
        + For client-side (implicit) apps, must be `token`
        + For server-side (confidential) apps, must be `confidential`
    + redirect_uri (optional, string) ...
        + If not supplied, user will be redirected to your app's **first** whitelisted `redirect_uri`, or if
          your application has no redirect_uris it will go to the copy-and-paste [debug uri](https://www.moneypot.com/oauth/debug):
           which will expose the raw token, for copy-and-paste
        + If supplied, user will be redirected there but it must be one of your apps whitelisted `redirect_uris`
    + state (optional, string)
        + An opaque string that will get sent back to your redirect_uri to preserve state or function as a anti csrf token


## Group General API info

* Parameter refers to a query string argument

* All requests must provide `access_token` or `app_secret` as a parameter (depending on if they are using the
implicit or confidential flow, respectively). The one exception is the `/v1/claim-faucet` api where the `app_secret` should
not be used, as requests come from the end user.

* All bodies for request and responses are JSON

* When making a request, using a `Content-Type` as `text/plain` will be interpreted the same way as `application/json`
but prevent CORS preflight requests

* All bitcoin values are in satoshis.

* The `auth` `id` or `auth_id` is an immutable reference to the authorization a user gives your app. It can be used like a "user id"
 to uniquely identify a user, as it will never change. Even if a user disables your app, and later re-enables it, it will have
  the same auth id. Unlike a `uname` the `auth_id` is guaranteed to not change.

# Group Dialogs

Dialogs are popups that you can provide on your app that allow users to manage their Moneypot account without navigating away from your app.

**To be notified when a user updates their balance** (thus when your app should make an API call to fetch their latest balance): define the app window's onmessage event handle, check if the event comes from moneypot.com, and then check if `event.data` is `'UPDATE_BALANCE'`:

Example:

``` javascript
window.addEventListener('message', function(event) {
  if (event.origin === 'https://www.moneypot.com' && event.data === 'UPDATE_BALANCE') {
    // ... Update user's balance ...
  }
}, false);

```

**TIP**: You generally want to give all of your dialogs the same `windowName` so that they all open within the same popup instead of creating a new popup for each different dialog.


## Deposit form [/dialog/deposit?app_id=XXX]

### GET

The deposit form lets users transfer funds from their Moneypot wallet into your app.

``` javascript
var windowUrl = 'https://www.moneypot.com/dialog/deposit?app_id=XXX';
var windowName = 'manage-auth';
var windowOpts = 'width=420,height=350,left=100,top=100';
var windowRef = window.open(windowUrl, windowName, windowOpts);
windowRef.focus();
```

It looks something like this:

![Deposit dialog](https://www.moneypot.com/img/api-docs/deposit-dialog.png)

When a user successfully submits the deposit form, the `window.onmessage` event handler will receive an event where `event.origin === 'https://www.moneypot.com'` and `event.data === 'UPDATE_BALANCE'`.

## Withdraw form [/dialog/withdraw?app_id=XXX]

### GET

The withdraw form lets users transfer funds from your app into their Moneypot wallet.

``` javascript
var windowUrl = 'https://www.moneypot.com/dialog/withdraw?app_id=XXX';
var windowName = 'manage-auth';
var windowOpts = 'width=420,height=350,left=100,top=100';
var windowRef = window.open(windowUrl, windowName, windowOpts);
windowRef.focus();
```

It looks something like this:

![Withdraw dialog](https://www.moneypot.com/img/api-docs/withdraw-dialog.png)

When a user successfully submits the withdraw form, the `window.onmessage` event handler will receive an event where `event.origin === 'https://www.moneypot.com'` and `event.data === 'UPDATE_BALANCE'`.


# Group v1 Public

These are publicly accessible endpoints, which require nothing more than the standard `app_secret` or `access_token`

---

## Get app info [/v1/app]

### GET

Get information on an app


+ Request implicit flow
    + Parameters
        + app_id (required, integer)
            The id of the app we are requesting information on
        + access_token (required, uuid)

    + Body

+ Request confidential flow
    + Parameters
        + app_id (required, integer)
            The id of the app we are requesting information on
        + app_secret
            The secret used to make requests

    + Body

+ Response 200  (application/json)

    + Body

        {
          "id": 1,
          "name": "Some App",
          "owners": [
              "some_user"
          ],
          "verified_domain": null,
          "created_at": "2015-04-21T09:15:20.827Z",
        }

+ Response 403 (application/json)

    + Body

        { "error": "INVALID_APP_ID" }



## Get bankroll [/v1/bankroll]

### GET

Gets the current bankroll information from MoneyPot.

Which means invested profit is balance-invested

+ Request implicit flow
    + Parameters
        + access_token (required, uuid)
    + Body

+ Request confidential flow
    + Parameters
        + app_secret (required, uuid)
    + Body

+ Response 200 (application/json)

    * `balance`  is how much currently is in the bankroll
    * `wagered` is how much has been bet in total
    * `invested` is how much has been invested, subtract what has been divested

    You can calculate the investor profit with `balance - invested`


    + Body

        {
            "balance": 2835838782.20769,
            "wagered": 20001333.23,
            "invested": 10000.32
        }


## Get token info [/v1/token]

### GET

Gives information about either an `access_token` or a `confidential_token` or a `hashed_token`. It allows you to ensure that the token is valid,
 for your app and information about the user. A `hashed_token` is the sha256 hash of a token. A hashed token can be used for nothing more
 than using this API.


+ Request implicit flow
    + Parameters
        + access_token (required, uuid)
            The `access_token` to the request originates from, as well as the `access_token` to get information on
    + Body

+ Request confidential flow, get info on an access_token
    + Parameters
        + access_token (require, uuid)
            The `access_token` to get information on
        + app_secret (required, uuid)
    + Body

+ Request confidential flow, get info on an confidential_token
    + Parameters
        + confidential_token (require, uuid)
            The `confidential_token` to get information on
        + app_secret (required, uuid)
    + Body

+ Request confidential flow, get info on hashed token
    + Parameters
        + hashed_token (require, uuid)
            The `confidential_token` to get information on
        + app_secret (required, uuid)
    + Body


+ Response 200 (application/json)
    + Body

        {
            "token": "82c5bbe7-d9fd-4f5d-a06c-e34e588db2fd",
            "expires_in": 1149539,
            "expires_at": "2015-05-18T23:28:12.873939+03:00",
            "kind": "access_token",
            "auth": {
                "id": 1,
                "app_id": 1,
                "user": {
                    "uname": "foo",
                    "balance": 312318.666666667,
                    "unconfirmed_balance": 123,
                    "unpaid": 0,
                    "betted_count": 60,
                    "betted_wager": 202220,
                    "betted_ev": -2022.18208660373,
                    "betted_profit": 62318.6666666666,
                    "role": "member"
                }
            }
        }

## Get user stats [/v1/user-stats]

### GET

Get stats on a user (scoped to the same app)


+ Request implicit flow
    + Parameters
        + uname (required, string)
            The uname of the user we are requesting information on. Will get information scoped to the app of the access_token
        + access_token (required, uuid)

    + Body

+ Request confidential flow
    + Parameters
        + uname (required, string)
            The uname of the user we are requesting information on. Will get information scoped to the app of the app_secret
        + app_secret
            The secret used to make requests

    + Body

+ Response 200  (application/json)

    + Body

        {
          "auth_id": 237,
          "uname": "foo",
          "betted_count": 37,
          "betted_wager": 0,
          "betted_ev": -1410.18092605379,
          "betted_profit": 41472.6666666667
        }


## Make a faucet claim [/v1/claim-faucet]


Note: faucet claims are rated limited based on the ip address. For this reason a confidential servers should
*not* make the request itself, but have the user do it. They **must not** give users their app_secret for making the request.

The faucet feature is based on google's recaptcha, to use it you will need to sign up to google recaptcha and provide
 the recaptcha secret in your apps control panel.

The faucet currently be claimed no more than once every 5 minutes




### POST


+ Request implicit flow
    + Parameters
        + access_token (required, uuid)
    + Body

        {
            "response": "the recaptcha response"
        }

+ Request confidential flow
    Note: The app_secret is **not** used, as this should come from the user

    + Parameters
        + auth_id (required, integer)
    + Body

        {
            "response": "the recaptcha response"
        }

+ Response 200 (application/json)

    + Body

        {
           "claim_id": 2343,
           "amount": 200
        }

+ Response 403 (application/json)

    Where "error_code" is one of:

    * "FAUCET_ALREADY_CLAIMED"  (faucet claimed in the last 5 minutes)
    * "INVALID_AUTH_ID"
    * "INVALID_ACCESS_TOKEN"
    * "NO_CONFIGURED_RECAPTCHA_SECRET" ( app owner needs to set this in the control panel)
    * "INVALID_INPUT_RESPONSE"   ( Google has rejected the response provided as invalid)

    + Body

        {
           "error": "error_code"
        }


## Get list of app bets [/v1/list-bets]

### GET

Return a list of bets from an app

+ Parameters

    + app_id (required, integer)
        + Show the bets related only to this app id
    + auth_id (optional, integer)
        + Optionally filter the bets to this auth_id
    + uname (optional, string) ...
        + Optionally filter the bets to this uname, if you know the auth_id it is preferred to use auth_id parameter
    + greater_than (optional, integer)
        + The bet id it must be greater than
    + less_than (optional, integer)
        + The bet id it must be less than
    + order_by (optional, string)
        + order by `asc` or `desc`, if not specified will default to `desc`
    + limit (optional, integer)
        + show only `limit` results. Must be between 1 and 100. Defaults to 100

+ Request confidential flow

    + Extra parameters
        + app_secret (uuid)

    + Body

+ Request implicit flow

    + Extra parameters
        + access_token (uuid)

    + Body


+ Response 200 (application/json)
    + Body

        [
            {
                 "id": 11,
                 "auth_id": 1,
                 "kind": 'simple_dice',
                 "client_seed": 0,
                 "wager": 1,
                 "ev": -0.01,
                 "profit": -1,
                 "app_profit": 0.005,
                 "bankroll_profit": 0.99,
                 "secret": 2192702185,
                 "salt": "b57229ccc2087d3521bec47044a558bf",
                 "created_at": "2015-07-10T20:52:13.444Z",
                 "user_id": 1,
                 "app_id": 1,
                 "uname": "foo",
                 "raw_outcome": 2192702185,
                 "outcome": 51.05,
                 "cond": "<",
                 "target": 49.5
             }
       ]

+ Response 403 (application/json)

    If the auth has been disabled, and you can not get information

    + Body

        { "error": "AUTH_NOT_ENABLED" }

+ Response 403 (application/json)

    + Body

        { "error": "INVALID_AUTH_ID_OR_SECRET" }



# Group v1 Auth

These end points are scoped specific to a particular `auth`. They can be accessed by providing a valid `access_token`
or (`auth_id` and `app_secret`)  by the query string

---

## Get auth info [/v1/auth]

### GET

Gets information about the auth

+ Request confidential flow

    + Parameters
        + auth_id (integer)
        + app_secret (uuid)

    + Body

+ Request implicit flow

    + Parameters
        + access_token (uuid)  Gets the current auth information

    + Body


+ Response 200 (application/json)
    + Body

        {
            "id": 1,
            "app_id": 1,
            "user": {
                "uname": "foo",
                "balance": 312318.666666667,
                "unpaid": 0,
                "betted_count": 60,
                "betted_wager": 202220,
                "betted_ev": -2022.18208660373,
                "betted_profit": 62318.6666666666
            }
        }

+ Response 403 (application/json)

    If the auth has been disabled, and you can not get information

    + Body

        { "error": "AUTH_NOT_ENABLED" }

+ Response 403 (application/json)

    + Body

        { "error": "INVALID_AUTH_ID_OR_SECRET" }


## Create a new hash for betting [/v1/hashes]

### POST

Create a new provably fair betting hash

+ Request implicit flow
    + Parameters
        + access_token (required, uuid)
    + Body

+ Request confidential flow
    + Parameters
        + auth_id (required, integer)
        + app_secret (required, uuid)
    + Body

+ Response 200 (application/json)

    + Body

        {
           "hash": "adad8e8016690d23581de9dc08ba2df3cb1b5b945158e7463e0054d74a5c734d"
        }

## Check if hash has been used [/v1/hashes]

### GET

If you have a hash but want to know if it has been consumed by a bet,
this endpoint will:

- Return a 200 response if the hash has not yet been used
- Return a 404 response if the hash has been used by a bet

+ Request implicit flow
    + Parameters
        + access_token (required, uuid)
        + bet_hash (required, string)
    + Body

+ Request confidential flow
    + Parameters
        + auth_id (required, integer)
        + app_secret (required, uuid)
        + bet_hash (required, string)
    + Body

+ Response 200 (application/json)
    + Body

        {
           "auth_id": 42,
           "hash": "adad8e8016690d23581de9dc08ba2df3cb1b5b945158e7463e0054d74a5c734d",
           "created_at": "2015-08-06T00:57:01.583Z"
        }
+ Response 404 (application/json)
    + Body

        "BET_HASH_NOT_FOUND"


## Get a deposit address [/v1/deposit-address]

### GET

Returns the latest generated address which can be used to deposit directly into this auth. Deposit address can be reused
but it is not recommended.

+ Request implicit flow
    + Parameters
        + access_token (required, uuid)
    + Body

+ Request confidential flow
    + Parameters
        + auth_id (required, integer)
        + app_secret (required, uuid)
    + Body

+ Response 200 (application/json)

    + Body

        {
           "deposit_address": "1bitcoineateraddressdontsendf59kue"
        }


## Tip another user [/v1/tip]

### POST

Send a tip to a user (by `uname`) an `amount` of satoshis, in the same application

+ Request implicit flow
    + Parameters
        + access_token (required, uuid)
    + Body
        {
            "uname": "Ryan",
            "amount": 50005
        }

+ Request confidential flow
    + Parameters
        + auth_id (required, integer)
        + app_secret (required, uuid)
    + Body
        {
            "uname": "Ryan",
            "amount": 50005
        }

+ Response 200 (application/json)

    + Body

        {
            "id": 2455,
            "from": "sending_uname",
            "to": "target_uname",
            "amount": 2000,
            "created_at": "2015-05-11T22:48:41.794Z"
        }



# Group v1 Bets

These endpoints expect either the parameter `access_token` OR (`app_secret` AND `auth_id`)

Furthermore in the body they all require:

* `wager`  (required, float) How much the auth is betting
* `hash` (required, string) Which provably fair hash we are betting against (got from `/v1/hashes` or the `next_hash` from a previous bet)
* `client_seed` (required, 32 bit unsigned int) a  number (0 to (2^32)-1) How much to shift the result (for provably fair)
* `max_subsidy` (optional, float) a value (in satoshis) of the most your app **is willing to pay** for this bet to be placed. This money
    is given to investors, from your app, when otherwise the bet would be too unattractive for investors to accept. We
    minimize the total subsidy given so his functions a pure limit. This defaults to 0, and is only settable *in the confidential flow*.
    It can also be set to a negative number, if you want the bet to be rejected unless you make a certain amount of profit.

All bets apis return:

* `id` (integer)
* `outcome` The final outcome for the api
* `secret` (string) the original provably fair secret the hash was based on
* `salt` (string) the salt the `secret` was protected with
* `next_hash` (string) a new hash, which can be used for placing the next bet
* `profit` (number) How much money the *auth*  (user) made from this bet


Note: Bets currently return a deprecated `bet_id`, please switch using `id`


"error_code" can be:
* `"NOT_ENOUGH_BALANCE"`  (If the auth can't make the bet, it doesn't have enough money)
* `"INVALID_ACCESS_TOKEN"`  (implicit flow)
* `"INVALID_AUTH_ID_OR_SECRET"` (confidential flow)

---

## Place custom bet [/v1/bets/custom]

### POST

A custom bet is the most flexible for all bet types. With this API you can provide an array of `payouts` which are a list
of possibly *overlapping* ranges, and how much money to win if it lands in this range.

Each `payout` in `payouts` has three fields:
* `from` (required, 32 bit unsigned integer)  The start of the range (inclusive)
* `to` (required, 1 to 2^32) The end of the range, exclusive
* `value` (required, number) The amount of satoshis to win, if the final outcome is in this range

If ranges are overlapping, multiple payouts can be won in a single game.


+ Request confidential flow (application/json)

    + Parameters
        + auth_id (required, integer)
        + app_secret (required, uuid)

    + Body

        {
          "client_seed": 123456789,
          "hash": "4e8ce7094c5781bd89169434d0403c0b29fc96f538b5c67623563a0c59bb1537",
          "payouts": [
            { "from": 0, "to": 2147483648, "value": 1100 },
            { "from": 0, "to": 400648, "value": 20000 }
          ],
          "wager": 1000,
          "max_subsidy": 10
        }

+ Request implicit flow (application/json)

    + Parameters
        + access_token (required, uuid)

    + Body

        {
          "client_seed": 123456,
          "hash": "4e8ce7094c5781bd89169434d0403c0b29fc96f538b5c67623563a0c59bb1537",
          "payouts": [
            { "from": 0, "to": 2147483648, "value": 1100 },
            { "from": 0, "to": 400648, "value": 20000 }
          ],
          "wager": 1000
        }

+ Response 200 (application/json)

    + Body

        {
          "id": 73454,
          "outcome": 2924272842,
          "profit": -1000,
          "secret": 2800816053,
          "salt": "2813102cbeee005055a5d4a9aa60894b",
          "next_hash": "adad8e8016690d23581de9dc08ba2df3cb1b5b945158e7463e0054d74a5c734d"
        }

## Place simple_dice bet [/v1/bets/simple-dice]

### POST

A simple dice gives an outcome between 0 and 99.99, making a total of 10,000 distinct outcomes. The simple dice API
allows you to bet if the outcome is less than ('<') or greater than ('>') a particular target.

Simple Dice fields:
* `payout` (required, number) The amount of satoshis to win, if the prediction is correct
* `cond` (required, '>' or '<') The direction of the bet, greater or less than `target`
* `target` (required, 0 to 99.99) The field `cond` applies to.  (Note: You can't bet < 0 or > 99.99)


+ Request confidential flow (application/json)

    In this example, the bet is +EV for the player (51% of 2x), so we offer a subsidy. But normally the bet would be -EV for the player
     and not require it to be subsidized.

    + Parameters
        + auth_id (required, integer)
        + app_secret (required, uuid)

    + Body

        {
          "client_seed": 12345,
          "hash": "4e8ce7094c5781bd89169434d0403c0b29fc96f538b5c67623563a0c59bb1537",
          "cond": "<",
          "target": 52.00,
          "payout": 2000,
          "wager": 1000,
          "max_subsidy": 1000
        }

+ Request implicit flow (application/json)

    + Parameters
        + access_token (required, uuid)

    + Body

        {
          "client_seed": 12345,
          "hash": "4e8ce7094c5781bd89169434d0403c0b29fc96f538b5c67623563a0c59bb1537",
          "cond": "<",
          "target": 50.00,
          "payout": 2000,
          "wager": 1000
        }

+ Response 200 (application/json)

    + Body

        {
          "id": 73454,
          "outcome": 63.32,
          "profit": -1000,
          "secret": 2800816053,
          "salt": "2813102cbeee005055a5d4a9aa60894b",
          "next_hash": "adad8e8016690d23581de9dc08ba2df3cb1b5b945158e7463e0054d74a5c734d"
        }




## Place plinko bet [/v1/bets/plinko]

### POST

Plinko is a simple game modeled after a [bean machine](http://en.wikipedia.org/wiki/Bean_machine) in which a balls falls
from the top of the board hitting a peg, where it has a 50% chance of going left, and a 50% chance of going right. After
which it falls through onto the next layer of pegs. This process keeps repeating until we finally land on the `pay_table` which says how much to win.

If there are N layers of pegs, there wil lbe N+1 elements in the paytable.

The only input the API requires is the `pay_table` which it will chop up into probability ranges for the provably fair API.
The server will then not only return the outcome (through standard provably fair mechanisms) but will tell the exact path
the ball went ('L' for left, 'R' for right).

Plinko fields:
* `pay_table` (required, array) An array of desirable multipliers. Given from left to right. The paytable must be between
2 elements ( 1 page layer) and 33 (32 decisions, the most our provably fair system can support)


+ Request confidential flow (application/json)

    + Parameters
        + auth_id (required, integer)
        + app_secret (required, uuid)

    + Body

        {
          "client_seed": 12345,
          "hash": "4e8ce7094c5781bd89169434d0403c0b29fc96f538b5c67623563a0c59bb1537",
          "wager": 100,
          "pay_table": [22, 5, 3, 2, 1.4, 1.2, 1.1, 1.0, 0.4, 1,  1.1, 1.2, 1.4, 2, 3, 5, 22]
        }

+ Request implicit flow (application/json)

    + Parameters
        + access_token (required, uuid)

    + Body

        {
          "client_seed": 12345,
          "hash": "4e8ce7094c5781bd89169434d0403c0b29fc96f538b5c67623563a0c59bb1537",
          "wager": 100,
          "pay_table": [22, 5, 3, 2, 1.4, 1.2, 1.1, 1.0, 0.4, 1,  1.1, 1.2, 1.4, 2, 3, 5, 22]
        }

+ Response 200 (application/json)

    + Body

        {
            "id": 13,
            "outcome": "LLLRRRLLLLLLRLLR",
            "profit": 20,
            "secret": 246593236,
            "salt": "5aebd1f790e6ad7cff0f5f0c8a170a48",
            "next_hash": "e7a3a56b161a8861685a485b8a901fa6a8c1f6e4b8b5762c3bacd989d6e675d1"
        }

## Place 101_dice bet [/v1/bets/101-dice]

### POST

101_dice gives an outcome between 0 and 100 (a total of 100 distinct outcomes). The simple dice API
allows you to bet if the outcome is less than ('<') or greater than ('>') a particular target.

Simple Dice fields:
* `payout` (required, number) The amount of satoshis to win, if the prediction is correct
* `cond` (required, '>' or '<') The direction of the bet, greater or less than `target`
* `target` (required, 0 to 100.) The field `cond` applies to.  (Note: You can't bet < 0 or > 100)


+ Request confidential flow (application/json)

    In this example, the bet is +EV for the player (51% of 2x), so we offer a subsidy. But normally the bet would be -EV for the player
     and not require it to be subsidized.

    + Parameters
        + auth_id (required, integer)
        + app_secret (required, uuid)

    + Body

        {
          client_seed: 12345
          hash: "4e8ce7094c5781bd89169434d0403c0b29fc96f538b5c67623563a0c59bb1537"
          cond: '<',
          target: 52,
          payout: 2000,
          wager: 1000,
          max_subsidy: 1000
        }

+ Request implicit flow (application/json)

    + Parameters
        + access_token (required, uuid)

    + Body

        {
          client_seed: 12345
          hash: "4e8ce7094c5781bd89169434d0403c0b29fc96f538b5c67623563a0c59bb1537"
          cond: '<',
          target: 50,
          payout: 2000,
          wager: 1000
        }

+ Response 200 (application/json)

    + Body

        {
          "id": 73454,
          "outcome": 63.32,
          "profit": -1000,
          "secret": 2800816053,
          "salt": "2813102cbeee005055a5d4a9aa60894b",
          "next_hash": "adad8e8016690d23581de9dc08ba2df3cb1b5b945158e7463e0054d74a5c734d"
        }
