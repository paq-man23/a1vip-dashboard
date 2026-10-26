# Al AI connection

The deployed function authenticates every request with Supabase Auth, checks live staff membership and category permissions, and verifies that the dashboard activity session is still valid. It uses a server-only OpenAI API key and the Responses API. No database service-role key is used.

To enable conversation, add `OPENAI_API_KEY` under this Supabase project's **Edge Functions → Secrets**. Do not put the key in source, the dashboard, or chat. `OPENAI_MODEL` is optional; the default is `gpt-5.6-terra`. OpenAI API billing is separate from a ChatGPT subscription. Review the provider billing settings before enabling the key.

After changing secrets, refresh the dashboard or clear Al's chat to retry configuration. The authenticated `{ "action": "status" }` request returns only whether the connection is configured. A live answer must be verified after configuring the key; mocked tests do not establish a working provider connection.

Al receives a maintained dashboard guide and a source-file map from `knowledge.mjs`. Update it whenever dashboard workflows change. This is curated implementation context, not autonomous access to the repository or runtime secrets.

The client sends the current message and up to eight recent AI conversation turns. It does not send the loaded customer/vendor/invoice database or rendered search-result cards. The function requests `store:false` from OpenAI. Browser dictation remains opt-in and transcripts are reviewed before sending.

The only model tool is a bounded dashboard action: search, navigation, invoice-draft selection, or a reviewed new-button proposal. The browser checks permissions again and performs its existing guarded operations. Al cannot save invoices, delete data, grant roles, email people, execute code, or run SQL. Similar-sounding contact results remain separate and require selection.

The function limits model requests to 20 per user per minute in each active Edge instance; this is a best-effort throttle, not a global billing cap. Review provider billing limits and alerts separately.
