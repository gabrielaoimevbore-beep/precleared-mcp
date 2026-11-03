# Precleared in Claude Managed Agents

[cold-email-compliance-checker.md](cold-email-compliance-checker.md) is a ready-made agent definition for [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) (in beta). The agent checks every recipient with Precleared before it drafts a cold email, drafts only for the people it is legal to contact, and returns a table of verdicts with receipt ids. It never sends email.

## Create the agent

- **Claude Console:** Agents, then Create, then start from a blank agent. Describe the agent or paste the settings and instructions from the file, and check that the MCP server `precleared` points at `https://precleared.dev/mcp`.
- **Command line:** `ant apply cold-email-compliance-checker.md` creates the agent and prints its ID.

The model is set to `claude-opus-5-5`. Any model your Console supports for agents will work.

## Environment and key

- If the environment limits networking, allow `precleared.dev`.
- No key is needed to start. Without one, checks use the free allowance, which sessions on Anthropic's servers share with other users. For steady use, get a free key at https://precleared.dev/get-key, add it to a credential vault as an access token for `https://precleared.dev/mcp`, and pass that vault when you start a session.

## Run it

Start a session and put the leads in the first message (or upload a CSV), with your country, the pitch and your footer details. The agent calls `contact_check` for each address by itself. You can also run it on a schedule.

Tested on 3 November 2026 with three leads in the UK, Germany and Latvia: the agent checked each address, drafted for the two leads it was allowed to email and skipped the one it wasn't.
