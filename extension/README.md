# Nova Intent Radar

Manifest V3 side-panel extension for Chrome and Microsoft Edge.

## Configuration

Build the extension against a Nova deployment:

```bash
VITE_NOVA_BASE_URL=https://nova.example.com npm run extension:build
```

For a stable unpacked-extension ID, set `VITE_EXTENSION_PUBLIC_KEY` to the
base64-encoded public key Chrome provides for the extension. Configure the same
32-character ID on Nova:

```bash
NOVA_EXTENSION_IDS=abcdefghijklmnopqrstuvwxyzabcdef
```

Multiple production or development IDs may be comma-separated. Development IDs
can alternatively be supplied with `NOVA_EXTENSION_DEV_IDS`.

## Local use

1. Run Nova on `http://localhost:3000`.
2. Run `npm run extension:build`.
3. Open `chrome://extensions` or `edge://extensions`.
4. Enable Developer mode and load `extension/dist` as an unpacked extension.
5. Copy the generated extension ID into `NOVA_EXTENSION_DEV_IDS`, restart Nova,
   rebuild/reload the extension, and sign in.

## Distribution

Publish the same build as a private or organization-restricted Chrome Web Store
and Microsoft Edge Add-ons listing. Keep the fixed store IDs in
`NOVA_EXTENSION_IDS`. No Firebase credentials, Nova cookies, API secrets, or
private keys belong in the extension bundle.

The extension requests page access only after a user gesture through
`activeTab`; it does not request permanent access to every website.
