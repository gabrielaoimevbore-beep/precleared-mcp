# Precleared for Dify: how to submit it

Everything is built, tested and packaged. Nothing has been posted or submitted yet.

## What's in this folder

- `precleared/`: the plugin source (what Dify runs).
- `tests/`: the unit tests (44, all passing). Not part of the package.
- `precleared-0.1.0.difypkg`: the package Dify's Marketplace takes.
- `upload-to-dify-plugins/precleared/precleared/precleared-0.1.0.difypkg`: the same package, already in the folder layout the Marketplace repository wants, so you can drag it in one go.
- `upload-to-precleared-mcp/integrations/dify/`: a copy of `precleared/` and `tests/` laid out for the precleared-mcp repository.
- `pr-body.md`: the pull request text, ready to paste.

## Step 1: put the source on GitHub (5 minutes)

Dify's rules say the README and manifest must link to the source, and they point at `precleared-mcp/integrations/dify`.

1. Open https://github.com/gabrielaoimevbore-beep/precleared-mcp, click **Add file**, then **Upload files**.
2. In Finder, open Downloads/Precleared/integrations/dify/upload-to-precleared-mcp and drag the `integrations` folder inside it onto the upload page. GitHub keeps the folders, so the files land at `integrations/dify/precleared/...` and `integrations/dify/tests/...`.
3. Commit message: `Add the Precleared plugin for Dify`. Choose **Commit directly to the main branch** and click **Commit changes**.

Do Step 1 before Step 2. Step 2 creates a `.env` file with your Dify debug key inside the `precleared` folder, and that must never be uploaded.

## Step 2 (optional): try it in Dify Cloud first (10 minutes)

The pull request says honestly that it hasn't been run inside a Dify workspace yet. If you'd like to try it first:

1. You need Python 3.12 on your Mac. In Terminal, `python3.12 --version` should print 3.12.x. If not, install it from https://www.python.org/downloads/.
2. Sign in at https://cloud.dify.ai, open **Plugins**, and click the debug (bug) icon. Copy the debugging URL and key.
3. In Terminal:

   ```
   cd ~/Downloads/Precleared/integrations/dify/precleared
   python3.12 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

4. Make a file called `.env` in that folder with three lines, pasting your URL and key:

   ```
   INSTALL_METHOD=remote
   REMOTE_INSTALL_URL=paste-the-url-here
   REMOTE_INSTALL_KEY=paste-the-key-here
   ```

5. Run `python -m main`. Precleared appears in your Dify plugins as a debugging plugin. Add a Precleared key in its settings, run **Check cold email compliance** on a test address in a workflow, then run **Get a receipt** with the receipt ID it gave you.
6. Press Ctrl+C to stop. Delete the `.env` file and the `.venv` folder afterwards.

If it works, add one line to the PR's reviewer notes: "Tested on Dify Cloud with remote debugging: both tools ran."

## Step 3: open the Marketplace pull request (10 minutes)

1. Open https://github.com/langgenius/dify-plugins/fork and click **Create fork** (under your account).
2. In your fork, click **Add file**, then **Upload files**.
3. From Finder, drag the `precleared` folder that's inside `upload-to-dify-plugins` into the page. It contains `precleared/precleared-0.1.0.difypkg`, which is the path Dify wants: `precleared/precleared/precleared-0.1.0.difypkg`. Check the page lists exactly that one file.
4. Choose **Create a new branch for this commit and start a pull request**, name the branch `add-precleared`, and click **Propose changes**.
5. On the pull request page, check the base is **langgenius/dify-plugins**, branch **main**.
6. Title: `Add Precleared tool plugin 0.1.0 (precleared/precleared)`
7. Body: paste all of `pr-body.md` (open it in TextEdit and copy everything).
8. Click **Create pull request** (not a draft).

The repository's checks run straight away. If a bot comments, tell Claude and it will fix the package and give you a new file. Once a maintainer merges it, the plugin is listed on the Dify Marketplace automatically.

## Good to know

- The plugin ID will be `precleared/precleared`. The first part is the author name in the manifest and can't be changed later without a new listing.
- The plugin requires a Precleared key. Dify sends requests from shared servers, and the allowance without a key is shared per network address, so keyless use from Dify would run out at once.
- Each Dify user who adds the plugin needs their own free key from precleared.dev/get-key, which brings them into the same key, low-balance and pack flow as everyone else.
