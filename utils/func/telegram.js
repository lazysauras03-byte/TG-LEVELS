const TelegramBot = require('node-telegram-bot-api');

// const telegramtoken ="8390227157:AAFYQ2eWFAJdm9P8me9Nk2voYe00Mn33dSU"
const telegramtoken = '8199688040:AAHGqr4cECCMb9kd4qXNM5bKAXXrqj8shQk';
const telegramchat ="8559767849"
const bot = new TelegramBot(telegramtoken, {polling: true});


module.exports =bot