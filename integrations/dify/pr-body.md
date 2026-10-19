# Plugin Submission

## Plugin information

- **Author**: precleared
- **Plugin name**: precleared
- **Version**: 0.1.0
- **Source repository**: https://github.com/gabrielaoimevbore-beep/precleared-mcp/tree/main/integrations/dify
- **Contact**: support@precleared.dev

## Submission type

- [x] New plugin
- [ ] Version update

## What changed

A new tool plugin for Precleared (https://precleared.dev). It checks whether a cold or marketing email to one recipient is allowed before an agent or workflow sends it, under UK, US, Canadian, German, French, Australian, Irish and Dutch rules. Each check returns the verdict, the rule quoted with its source, what the email's footer must include, the next step and a signed receipt ID.

Two tools:

- **Check cold email compliance** calls `POST https://precleared.dev/api/v1/check`. Besides a short text summary and the full JSON answer, it declares output variables (`verdict`, `ok_to_send`, `rule`, `rule_source`, `next_step`, `footer_text`, `receipt_id`, `error`) so a workflow can branch on the result.
- **Get a receipt** calls `GET https://precleared.dev/api/v1/receipt` to fetch a past check by its ID.

## Risk level

- [ ] Low risk
- [x] Medium risk
- [ ] High risk

Medium because the plugin sends user content, a recipient's email address and the pitch text, to an external service.

## Required checks

- [x] I have read and followed the [Marketplace submission requirements](https://github.com/langgenius/dify-plugins/blob/main/docs/plugin-submission-requirements.md).
- [x] I have read and comply with the Plugin Developer Agreement.
- [x] I tested this plugin on Dify Community Edition and Dify Cloud, or documented any limitation below.
- [x] The package contains only files needed at runtime.
- [x] The package does not contain secrets, local credentials, `.env` files, `.git` directories, virtual environments, caches, logs, or IDE files.
- [x] The package does not contain executables or bundled binaries, or I explained why they are required below.
- [x] The plugin README includes setup steps, usage instructions, required APIs or credentials, connection requirements, and the source repository link.
- [x] The plugin includes `PRIVACY.md` or a hosted privacy policy, and `manifest.yaml` references it.
- [x] All user-facing text is primarily in English, with any localized README files following the [i18n guidance](https://docs.dify.ai/en/develop-plugin/features-and-specs/plugin-types/multilingual-readme).

## Security and privacy notes

- **Network**: outbound HTTPS requests to one fixed host only, `precleared.dev`, declared under `network.domains` in `manifest.yaml`: `POST /api/v1/check`, `GET /api/v1/receipt` and `GET /api/v1/key`. Users cannot change the destination, and there is no arbitrary URL fetching. Requests time out after 35 seconds, with 10 seconds to connect.
- **Data sent**: the check sends the recipient's email address or domain and only the optional fields the user sets (sender country, address source, pitch, recipient country, fallback country, UK company number, pitch relevant, existing customer, suppressed). This is personal data, but not a sensitive category. Precleared stores each check and a signed receipt; receipts show the address masked. The receipt tool sends only the receipt ID. Details are in `PRIVACY.md`.
- **Credentials**: a required Precleared API key (`secret-input`), sent only in the `Authorization` header to `precleared.dev`. It is validated with `GET /api/v1/key`, which uses none of the user's allowance. The key is never logged, and it is redacted from any message the plugin returns. Errors come back as plain messages without credentials.
- **Input constraints**: a recipient email or domain is required; country codes must be two letters; sender country and address source are fixed lists; receipt IDs must match `cc_rcpt_` followed by 16 capital letters or digits. All of these are checked before any request is made.
- **Not present**: no command or code execution, SQL, file operations, browser automation, user-controlled URLs or financial actions.

## Local validation

```
python3 validator/validate-difypkg.py precleared-0.1.0.difypkg --pr-body-file pr-body.md --output-dir report
Exit code 0. Blocking failures: 0. Warning categories: 3.
package_contents, package_secrets, package_binaries, manifest_metadata, readme_metadata,
package_dependencies, python_compile, sensitive_capabilities (blocking): PASS
python_safety, prohibited_financial_activity (warning): PASS, no findings
access_domains (warning): precleared.dev detected, matches network.domains
dependency_vulnerabilities (warning): 2 pinned, 0 unpinned; the OSV database was not reachable
from my environment, so the dependency vulnerability lookup is left to this repository's CI
sensitive_capabilities: the two HTTPS calls to precleared.dev in tools/client.py, disclosed above
```

Also run locally:

- 44 unit tests with mocked HTTP: both tools, every error code (400, 401, 402, 404, 429, 5xx, timeouts), the email-or-domain rule and credential validation. All pass.
- The plugin loads through `dify_plugin` 0.10.2's `PluginRegistration`, so every YAML file validates against the SDK models.
- `validator/test-plugin-install.py` (serverless mode, as in this repository's CI) passes.
- Packaged with the `dify` CLI from langgenius/dify-plugin-daemon v0.6.11.

## Reviewer notes

Disclosure: I built Precleared, and I wrote this with help from Claude.

The API key is required rather than optional because Dify sends requests from shared servers, and Precleared's allowance without a key is shared by everyone on the same network address.

Limitation: the plugin has been tested with the unit tests, the SDK loader, the start-up test and the validator above, but not yet inside a running Dify workspace (Community Edition or Cloud).
