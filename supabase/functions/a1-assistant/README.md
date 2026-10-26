# Al: internal-only mode

Al uses local dashboard guidance and searches records through the existing permission-checked Supabase client. The browser never calls an external AI provider. Browser speech recognition is disabled because its audio processing may use an outside provider.

This Edge Function remains as a fail-closed endpoint for older dashboard versions. It verifies Auth, current staff membership and the dashboard session, then returns `configured:false, internalOnly:true`. It does not read provider keys or contact any model service, even if provider secrets exist in the project.

Customer, vendor and invoice records still use the dashboard’s existing Supabase storage and authorization. “Internal” does not mean offline or device-only. Assistant chat stays in memory and clears at sign-out; it is not uploaded as AI conversation history.

Future conversational AI and voice processing must use an explicitly approved private deployment. Adding an API key does not activate an external provider.
