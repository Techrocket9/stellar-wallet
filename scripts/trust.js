'use strict'
const chalk = require('chalk')
const minimist = require('minimist')
const inquirer = require('inquirer')
const StellarSdk = require('stellar-sdk')
const StellarBase = require('stellar-base')
const config = require('./config.json')
const {Asset} = require("stellar-sdk");

const server = new StellarSdk.Server('https://horizon.stellar.org')

console.log(chalk.green('-----------------------------------------------'))
console.log(chalk.green('Stellar Wallet'), chalk.yellow('Trust Token Issuer'))
console.log(chalk.green('-----------------------------------------------'), '\n')

const argv = minimist(process.argv.slice(2))
const currencyType = StellarSdk.Asset.native()

const getBalance = (address) => {
  return server.loadAccount(address).then((account) => {
    let xlmBalance = 0
    account.balances.forEach((balance) => {
      if (balance.asset_type === 'native') xlmBalance += balance.balance
    })
    return +xlmBalance
  }).catch(fail)
}

const waitForBalancesUpdate = (sourceAddress, destinationAddress, origSourceBalance) => {
  Promise.all([
    getBalance(sourceAddress),
    getBalance(destinationAddress)
  ]).then(([sourceBalance, destinationBalance]) => {

    if (sourceBalance < origSourceBalance) {

      console.log('New source balance:', chalk.green(sourceBalance, config.currency))

      console.log('New destination balance:', chalk.green(destinationBalance, config.currency))

      process.exit(0)

    } else {

      setTimeout(() => waitForBalancesUpdate(sourceAddress, destinationAddress, origSourceBalance), 1000)

    }

  })
}

const fail = (message) => {
  console.error(chalk.red(message))
  if (message.response && message.response.data && message.response.data.extras && message.response.data.extras.result_codes && message.response.data.extras.result_codes.operations) {
    const reason = message.response.data.extras.result_codes.operations;
    switch(reason) {
      case 'op_underfunded':
        console.log(chalk.red('reason:', 'Sender account has insufficient funds'));
        break;
      default:
        console.log(chalk.red('reason:', reason))
    }
  }
  process.exit(1)
}

const questions = [
  {
    type: 'input',
    name: 'newasset',
    default: argv.newasset,
    message: 'Enter asset to trust:',
    validate: (value) => value && value.length > 26 ? 'Please enter a valid memo' : true,
  },
  {
    type: 'input',
    name: 'issuer',
    default: argv.issuer,
    message: 'Enter issuer address:',
    validate: (value) => StellarBase.StrKey.isValidEd25519PublicKey(value) ? true : 'Please enter a valid address'
  },
  {
    type: 'input',
    name: 'sourceSecret',
    message: 'Enter sender secret:',
    validate: (value) => StellarBase.StrKey.isValidEd25519SecretSeed(value) ? true : 'Invalid secret'
  }
]

inquirer.prompt(questions).then((answers) => {
  const sourceKeypair = StellarSdk.Keypair.fromSecret(answers.sourceSecret)
  const sourceAddress = sourceKeypair.publicKey()

  return Promise.all([]).then(() => {

  console.log()

    inquirer.prompt([
      {
        type: 'confirm',
        name: 'sure',
        default: false,
        message: 'Ready to add trust line?'
      }
    ]).then((confirm) => {
      if (!confirm.sure) {
        process.exit()
      }

      console.log('\nConnecting...')
      server.loadAccount(sourceAddress)
        .then((account) => {

          console.log('Preparing payment transaction...')
          let transaction = new StellarSdk.TransactionBuilder(account, { fee: StellarBase.BASE_FEE, networkPassphrase: StellarBase.Networks.PUBLIC })
            .addOperation(StellarSdk.Operation.changeTrust({
              asset: new Asset(answers.newasset, answers.issuer),
            })).setTimeout(1000)

          // Finalize
          transaction = transaction.build()
          transaction.sign(sourceKeypair)

          console.log('Submitting payment...')
          server.submitTransaction(transaction)
            .then((transactionResult) => {
              console.log('\nSuccess! View the transaction at: ')
              console.log(chalk.yellow(transactionResult._links.transaction.href), '\n')
            })
            .catch(fail)
        })
        .catch(fail)
    })

  })
})
