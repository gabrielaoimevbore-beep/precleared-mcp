# Privacy policy: Precleared plugin for Dify

This plugin connects Dify to Precleared (https://precleared.dev), a service that checks whether a cold or marketing email to a recipient is allowed. This page explains what the plugin sends, where it goes and what is stored.

## What the plugin sends, and where

The plugin sends data to one external service only: Precleared, at precleared.dev, over HTTPS.

- **When you save your credentials**, the plugin sends your Precleared API key to check that it is valid. This does not use up a check.
- **When Check cold email compliance runs**, the plugin sends the fields you or your agent set for that check: the recipient's email address or domain, and any of sender country, address source, pitch, recipient country, fallback country, UK company number, whether the pitch is relevant, whether the recipient is an existing customer and whether they are on your do-not-contact list. Your API key goes in the Authorization header.
- **When Get a receipt runs**, the plugin sends the receipt ID. The API key is not sent with this request.

Nothing is sent to the recipient, and the plugin sends no data to any other third party.

## What Precleared does with it

To reach a verdict, Precleared may look up public information about the recipient's company, such as the UK Companies House register and the company's own website. Precleared stores each check and a signed receipt so the check can be shown to a client, auditor or regulator later. Receipts show the recipient's address masked. Precleared's full privacy policy, including how long data is kept and your rights, is at https://precleared.dev/privacy.

## What the plugin itself collects, stores or logs

The plugin does not store, cache or log any personal data, check results or credentials. It does not write the API key to logs or include it in any message it returns. Dify stores the API key you enter as an encrypted credential, as it does for every plugin.

## Contact

Questions about this policy or about data held by Precleared: support@precleared.dev.
