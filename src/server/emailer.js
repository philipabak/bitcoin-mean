"use strict";
// 3rd party
var nodemailer = require('nodemailer');
var assert = require('better-assert');
var _ = require('lodash');
var m = require('multiline');
var swig = require('swig');
var debug = require('debug')('app:emailer');
// 1st party
var belt = require('../belt');
var config = require('config');


var transport = nodemailer.createTransport({
  service: "Mandrill",
  auth: {
    user: config.get('MANDRILL_USER'),
    pass: config.get('MANDRILL_PASSWORD')
  }
});

var templates = {
  resetToken: swig.compile(m(function() {/*
    <p>Hello {{ uname }},</p>

    <p>This link will take you to a form that will let you type in a new password:</p>

    <a href='{{ host }}reset-password?token={{ token }}'>
      {{ host }}reset-password?token={{ token }}
    </a>

    <p>If you did not expect this email, you can ignore it and nothing will happen.</p>
  */})),

  support: swig.compile(m(function() {/*
   <p>Support ticket sent by {{ by }}</p>
   <hr>
   <p>{{ message }}</p>
   <hr>
   <p>IP Address: {{ ip_address }}</p>
  */}))
};

exports.sendResetTokenEmail = function(toUname, toEmail, token) {
  debug('[sendResetTokenEmail]');
  assert(config.get('SUPPORT_EMAIL'));
  assert(config.get('HOST'));
  assert(_.isString(toUname));
  assert(_.isString(toEmail));
  assert(belt.isValidUuid(token));
  transport.sendMail({
    from: config.get('SUPPORT_EMAIL'),
    to: toEmail,
    subject: 'Password Reset Token - MoneyPot',
    html: templates.resetToken({
      uname: toUname,
      host: config.get('HOST'),
      token: token
    })
  }, function(err, info) {
    // TODO: Log errors in background.
    // Since we don't expose to user if they entered a valid email,
    // we can't really do anything upon email failure.
    debug('Tried sending email from <%s> to <%s>', config.get('SUPPORT_EMAIL'), toEmail);
    if (err)
      return belt.logError('Could not send email to: ' + config.get('SUPPORT_EMAIL') + ' got error ' + err);

    debug('Sent email, got: ', info);
  });
};


function sendSupportMail(currUser, fromEmail, message, ip_address) {

  return new Promise(function (resolve, reject) {
    if (!config.get('SUPPORT_EMAIL_TO'))
      return reject(new Error('SUPPORT_EMAIL_TO not set'));

    transport.sendMail({
      from: config.get('SUPPORT_EMAIL'),
      replyTo: fromEmail,
      to: config.get('SUPPORT_EMAIL_TO'),
      subject: 'Support Request',
      html: templates.support({
        by: currUser ? ('User: ' + currUser.uname) : ('Anon: ' + fromEmail),
        message: message,
        ip_address: ip_address
      })
    }, function (err, info) {
      if(err) return reject(err);
      resolve(info);
    });
  });
}


// Sends support mail from the support page to email staff
// returns a promise
exports.sendSupportEmail = function(currUser, fromEmail, message, ip_address) {
  assert(_.isString(fromEmail));
  assert(_.isString(message));

  debug('Sending support email: ', fromEmail, message, ip_address);

  return sendSupportMail(currUser, fromEmail, message, ip_address);

};
