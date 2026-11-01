# Yogi LanDrive

Yogi LanDrive is a small local-network file browser. Run it on laptop B, then open the LAN address printed by the server from a browser on laptop A. It supports folder navigation and creation, downloads, uploads with per-file progress (including drag-and-drop), and permanent deletion of files and folders.

## Development with automatic reload

After installing dependencies, run:

```sh
npm install
npm run dev
```

In development, open `http://localhost:5173` on laptop B or `http://<laptop-B-local-IP>:5173` on laptop A. Vite automatically refreshes the browser when React or CSS files change, and Node watches and restarts the Express server when server files change. Keep this command running while editing.

## Production

```sh
npm run build
npm start
```

Production serves the last built frontend from `dist`; source edits will not appear until you run `npm run build` again and restart the server.

Set the storage folder and (optionally) the port in the `.env` file in the project directory:

```dotenv
STORAGE_DIR=/path/to/shared/files
PORT=8080
```

By default, files are stored in the `storage` folder in the project directory. The `.env` file is local configuration and is excluded from version control.

The server listens on all network interfaces (`0.0.0.0`) so other devices on the same network can connect. If the printed address does not work, check laptop B's local IP address and allow the chosen port through its firewall.

## Network access

There is intentionally no authentication: anyone who can reach the server can browse, download, upload, create folders, and permanently delete files and folders in its storage directory. Folder deletion removes all its contents. Use it only on a trusted network, do not expose the port to the public internet, and stop the server when file sharing is no longer needed.
