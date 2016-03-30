
# For Users

## What is MoneyPot?
MoneyPot is a bitcoin web wallet that lets you manage your funds across many MoneyPot casinos. Or maybe you just want to use MoneyPot as nothing more than a web wallet. That's cool, too.

## Why use MoneyPot?

  * MoneyPot gives you the ability to instantly move your money between MoneyPot apps and other users. Without creating and
  managing new accounts, you can easily try new apps knowing they can only spend what you give them to spend. You also get a complete history of each app's impact on your funds so that you can audit them. You can also confirm that an app is using our provably-fair system.

  * One of our chief goals is to protect your privacy. When you deposit money into MoneyPot, we generate a fresh address instead of reusing known addresses.

## What are cold addresses?

  * Cold addresses are bitcoin addresses that are not connected to our hot wallet, but rather direct to an offline cold wallet.
    We never use this cold wallet for processing withdrawals, which in general makes it impossible for any blockchain analysis
    to reveal that you are depositing funds into MoneyPot. We charge 1% for this service (otherwise everyone would use it, and it would
    become a defacto hot wallet). **This is an ideal solution when depositing from services that track what you do with your money, such coinbase**

## Why should we trust you?

  * You should not keep much money on our service, treating it similar as you would a physical wallet and aiming to secure the rest with a hardware wallet such as
  a [trezor](https://www.buytrezor.com).

  * We are already established in bitcoin gambling scene; this isn't our first rodeo. We are the same team that develops and runs [bustabit.com](https://www.bustabit.com). Bustabit has
  processed over 6,500 BTC in deposits and withdrawals without issue.

  * To demonstrate solvency we show we have more assets than liabilities. Our [proof-of-liabilities](/proof-of-liabilities.txt)
   which use daily user nonces, which can be found in each users "settings". While our [proof-of-assets](/proof-of-assets.txt) shows we
   exceed such liabilities in bitcoin holdings.

## What does it mean to deposit money into an app? What is my app balance?

To keep applications firewalled from your Moneypot wallet, Moneypot requires you to "deposit" bitcoin into an app before you can use/spend it at that app. If you have 1,000 bits deposited in an app, then the app only has access to those 1,000 bits. When you're done with an app, simply withdraw the app balance back into your Moneypot wallet. Alternatively, you can simply disable an app which will prevent that app from accessing the funds you're deposited in it. You can always re-enable the app in the future.

You only want to deposit money into apps that you trust. However, even if you trust an app's owners, you still want to minimize the amount of money you have deposited into apps. Imagine if an attacker breaches an app's database or finds an exploit that gives them access to your balance at that app. Or imagine if the app owner left their app's database password on a post-it-note near their computer and their roommate gained access to their server. Moneypot has no control over these scenarios, but you have control over the amount of bitcoin you risk at an app.

The point is that you need to remain vigilant about limiting the amount of risk you expose your money to. Since apps are created and managed by users, Moneypot cannot guarantee that apps are written securely. In other words, Moneypot does not know if an app has any security holes or not that, for example, would allow an attacker to spend your balance with that app. Moneypot does not know if an app owner has their database password sitting out on their desk.

Understanding these risks is crucial.

## What does "Domain Not Verified" mean for an app?

When someone makes a Moneypot app, it starts off "unverified". This is because anyone can create an app and then give it the name of an existing, genuine casino. This malicious owner can then try to convince other users to deposit money into their imposter casino, deceiving others into thinking that they are depositing money into the genuine, trusted casino with the same name.

To prevent this sort of abuse, we verify the ownership and authenticity of genuine casinos. All this means is that we have ensured that a casino is not an imposter of another casino with the same name and that you can be sure that this app named "Dust Dice" (for example) is the app that you think it is.

Apps have a red "Domain Not Verified" warning displayed next to their name until they are verified. Manage your trust accordingly.

Note: when we verify a casino, it does not mean that we personally vouch for the casino. It does not mean that the casino will not be malicious down the road.


-----
# For Investors

## What is the investment option?
MoneyPot gives you the option to invest, however it's not an equity investment but rather a bankroll one. You invest and own a % of the bankroll, which allows gamblers to bet against it. If they win, the bankroll get smaller, if they lose, the bankroll increases, but your stake remains the same. You may invest or divest at anytime, there's no minimium investing time.

## How risky is this?
Extremely. You are risking your entire investment amount, and you should never invest more than you would be ok with losing. Furthermore, your risks are compounded by counter-party risks. You have no way of knowing we won't steal all your money (even though we promise not to), or that there isn't an abusable weakness that would allow an attacker to unnoticed drain the bankroll. There are a lot of nighmare possibilities, invest accordingly

## What bets do you accept against the bankroll?
We use the generalized [kelly criterion](http://en.wikipedia.org/wiki/Kelly_criterion), to determine if a bet is acceptable or not. For a given bet, the Kelly criterion tells us how much of our bankroll we should risk. We will only ever risk *less* than the kelly suggests, and never more.

## What commissions do you charge?
MoneyPot charges a 10% comissions on all profits. Furthermore to this, all apps are paid a commission of up to 50% of the
house edge. So this means if someone bets 1 BTC with a house edge of 1%, from the investors perspective it is much more
similiar to a 0.5% house edge bet, as the investors give the app half the house edge (in this case 0.005 BTC) in comission.

However, we do respect the kelly and will never put investors at more risk than that.

## Can I risk more or less?

You can not risk more, as all investments are already risking everything (someone could win 99.999% in a single game, if
 they were playing against a 99.999% house edge). You can however risk less, but investing less. Because the bankroll is
 currently quite small compared to some bets, it would be advisable to invest a significantly smaller amount than you otherwise would.

---

# For App Developers


## What does MoneyPot offer?

 We offer app developers quite a lot, so you can focus building a great app. Our service handles:

  * The bitcoin stuff

    We handle all the hard stuff like [blockchain reorganization](https://en.bitcoin.it/wiki/Chain_Reorganization) and
  [double spends](https://en.bitcoin.it/wiki/Double-spending), so you don't need to reinvent the wheel for every app.

  * Security

    With funds and accounts on our system, we do security for you and are in the crosshairs of hackers, not you. We manage cold, warm and hot wallets and do the proof of solvency so you don't have to.

  * A bankroll to support large bets

    You have full access to our investor bankroll, and can support large bets with no risk. Your users can also invest to
     be part of your success.

  * Gambling Maths, even for complex bets

    All bets are verified to make sure they satisfy a complex criterion, to minimizes the risk of ruin, while ensuring positive expected bankroll growth. We handle this in the general case, for complex bets with multiple outcomes.


  * Risk-free earnings

    Bankroll investors risk money, not you. You can focus on delighting your customers, and can sleep soundly even if there's a whale destroying the bankroll. You make a commission.

  * Serverless apps

    You can write an engaging app, without the need for a server, by using the oauth2 implicit flow API.  DustDice.com is an
    example of a pure-client side gambling game that leans on MoneyPot for all functionality.

  * Access to our users, and trust

    Our users already know and trust us, have accounts with balances and are looking to gamble. With 1 click, they can be
    connected to your app and playing. Users don't have to trust you, because they already trust MoneyPot and can check there.


  * Provably fair, for both you and your users

    All bet results are provably fair, which means you can offer the proof to your users. But more than that, you can check
    it yourself, to make sure your users are getting a fair deal and you are getting your commissions.

## How much do you charge?

  MoneyPot is 100% free, both for users and app developers. Not only this, but we'll pay you! App developers get paid
   50% of the house edge on all bets *against our bankroll*, assuming that does not push investors over the full kelly.
   Riskier bets (0.5 to 1) of the kelly result in reduced commisions. If you wish to exceed a fully kelly, you will need
   to compensate the investors (see: API for 'max_subsidy').  We advise you never place bets on the bankroll greater than
   a half kelly, to keep commissions predictable.