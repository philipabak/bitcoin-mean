# MoneyPot (code name: Vault)

A bitcoin web wallet among other things.

## Installation

Vault uses Node v0.12.x (with --harmony) and Postgres v9.4.

Use `sql/schema.sql` to construct the initial database.

### Configuration

To override any configuration, create a file: `config/local.json` to override anything from `config/default.json`. You
can also create a `config/$NODE_ENV.json` file specific for a NODE_ENV setting


### Database Schema

    npm run resetdb

Which will create and/or reset the database. Note: This should only be used in development, as it will also load the dev seed
data.


### Running

    npm install
    npm start

Or with development conveniences

    npm run start-dev

## Tests

    npm test

Or passing an argument to mocha

    npm run test -- -f hash   # will only run tests that contain 'hash'

## API docs

API docs can be built with `npm run install` and viewed with `npm run view-api-docs` and opening http://localhost:3002/api-docs.html


## Cloudflare Ips
(including here to diff against any possible changes)

https://www.cloudflare.com/ips-v4

199.27.128.0/21
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/12
172.64.0.0/13
