export const knowledge = {
  "purpose": "Al is the friendly Golden Ticket companion for A1VIP Dashboard, not a generic support chatbot.",
  "sections": [
    [
      "main",
      "Main Links"
    ],
    [
      "luxury",
      "Suites"
    ],
    [
      "accounts",
      "Ticket Accounts"
    ],
    [
      "travel",
      "Travel"
    ],
    [
      "social",
      "Social"
    ],
    [
      "invoices",
      "Invoices & POs"
    ],
    [
      "customers",
      "Customers"
    ],
    [
      "vendors",
      "Vendors"
    ],
    [
      "formLetter",
      "Letters"
    ],
    [
      "tripItinerary",
      "Trips"
    ],
    [
      "admin",
      "Admin"
    ],
    [
      "manageAccounts",
      "Manage Accounts"
    ]
  ],
  "regularGuides": {
    "add": "To add a website button:\nAsk me: “add button for example.com in main”. I’ll show the address and category for you to review, then you choose Add Button.\nYou can also open My Buttons, enter a label and website address, choose an enabled category, then Save Choices. Your new buttons belong to your personal layout.",
    "move": "To move a button:\n1. Open the category containing the button.\n2. On a computer, drag it onto the destination category icon. On a phone or tablet, press and hold the button, then drag it to the category. For ticket-account links, start moving after the short hold; a stationary three-second hold is the private-browser shortcut for admins.\n3. Confirm the move.\nYour moves affect only your own layout. You can move links only between categories enabled for you.",
    "hide": "Open My Buttons, uncheck a button you don’t want to see, then choose Save Choices. Recheck it there to show it again. Links restricted by an administrator cannot be restored by a regular user.",
    "password": "Choose Change Password beside your signed-in name. Enter your current password and the new password, then save. If you cannot sign in, use Forgot Password on the login screen.",
    "refresh": "Choose Refresh App beside your name to load the newest dashboard files. The Refresh History / Refresh Contacts buttons inside a section reload that section’s saved records.",
    "layout": "Use the layout menu beside your name to choose Auto, Tablet · Right, or Vision Pro. The choice is remembered on this device. Drag Al to move him; drag the corner of his speech bubble to resize it.",
    "invoices": "Open Invoices & POs. Choose invoice or purchase order, start a new document, select a saved contact, add the event or items and prices, and review the preview. Use Save when you are ready. Saved documents are under History. You can also ask me “create an invoice for Acme” to prepare a draft.",
    "contacts": "Open Customers or Vendors. Search by name, company, email, or phone, or use the alphabet tabs. Select a card to view or edit it. Choose Add Customer / Add Vendor for a new card, then Save Contact. Contacts can be selected in document editors when you have access to those categories.",
    "sections": "Here’s what is in your dashboard sections:\nMain Links — Everyday website shortcuts and your own links.\n\nSuites — Suite booking, premium hospitality, and suite-provider websites.\n\nTicket Accounts — Team ticket-account links. Admins can use private-browser shortcuts; regular users open websites inside the dashboard.\n\nTravel — Travel websites, including private jets, luxury homes, and yachts.\n\nSocial — Social-media and communication shortcuts.\n\nInvoices & POs — Create and search invoices and purchase orders, manage line items, and review saved history.\n\nCustomers — Searchable customer cards with names, companies, contact details, notes, and photos.\n\nVendors — Supplier and vendor cards, including contact details used for purchase orders.\n\nLetters — Create, preview, and save reusable letters.\n\nTrips — Build and find itineraries with events, hotels, flights, rental cars, and contacts."
  },
  "adminGuides": {
    "add": "To add a website button:\nAsk me: “add button for example.com in main”. I’ll show the address and category for you to review, then you choose Add Button.\nYou can also paste a website address into the top link bar and choose Add to Main, or use Admin → Button Manager. Admin additions are shared dashboard buttons.",
    "move": "To move a button:\n1. Open the category containing the button.\n2. On a computer, drag it onto the destination category icon. On a phone or tablet, press and hold the button, then drag it to the category. For ticket-account links, start moving after the short hold; a stationary three-second hold is the private-browser shortcut for admins.\n3. Confirm the move.\nAdmin moves update the shared layout. Personal links remain personal.",
    "hide": "Open My Buttons, uncheck a button you don’t want to see, then choose Save Choices. Recheck it there to show it again. Links restricted by an administrator cannot be restored by a regular user.",
    "password": "Choose Change Password beside your signed-in name. Enter your current password and the new password, then save. If you cannot sign in, use Forgot Password on the login screen.",
    "refresh": "Choose Refresh App beside your name to load the newest dashboard files. The Refresh History / Refresh Contacts buttons inside a section reload that section’s saved records.",
    "layout": "Use the layout menu beside your name to choose Auto, Tablet · Right, or Vision Pro. The choice is remembered on this device. Drag Al to move him; drag the corner of his speech bubble to resize it.",
    "invoices": "Open Invoices & POs. Choose invoice or purchase order, start a new document, select a saved contact, add the event or items and prices, and review the preview. Use Save when you are ready. Saved documents are under History. You can also ask me “create an invoice for Acme” to prepare a draft.",
    "contacts": "Open Customers or Vendors. Search by name, company, email, or phone, or use the alphabet tabs. Select a card to view or edit it. Choose Add Customer / Add Vendor for a new card, then Save Contact. Contacts can be selected in document editors when you have access to those categories.",
    "sections": "Here’s what is in your dashboard sections:\nMain Links — Everyday website shortcuts and your own links.\n\nSuites — Suite booking, premium hospitality, and suite-provider websites.\n\nTicket Accounts — Team ticket-account links. Admins can use private-browser shortcuts; regular users open websites inside the dashboard.\n\nTravel — Travel websites, including private jets, luxury homes, and yachts.\n\nSocial — Social-media and communication shortcuts.\n\nInvoices & POs — Create and search invoices and purchase orders, manage line items, and review saved history.\n\nCustomers — Searchable customer cards with names, companies, contact details, notes, and photos.\n\nVendors — Supplier and vendor cards, including contact details used for purchase orders.\n\nLetters — Create, preview, and save reusable letters.\n\nTrips — Build and find itineraries with events, hotels, flights, rental cars, and contacts.\n\nAdmin — Administrator tools, login history, website panel time, imports, and shared dashboard setup.\n\nManage Accounts — Administrator account management, user category access, and assigned links and layouts."
  },
  "implementation": {
    "index.html": "Dashboard sections, invoice/letter/trip editors, navigation and shared link layout.",
    "a1-data.js": "Supabase-backed auth, permissions, lazy section loading and guarded persistence.",
    "a1-assistant.js": "Speech-bubble UI, reviewed actions, actual client-side dashboard search.",
    "assistant-core.js": "How-to knowledge, intent fallback, phonetic candidate matching.",
    "assistant-actions.js": "Reviewed website-button additions, shared for admins and personal for users.",
    "assistant-position.js": "Movable character, auto-fitting bubble, manual resizing and scroll cue.",
    "button-moves.js": "Confirmed shared or personal moves.",
    "a1-activity.js": "Personal links, inactivity handling and admin-only timecards.",
    "a1-accounts.js": "Admin account and layout setup."
  }
};
