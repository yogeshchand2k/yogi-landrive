import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(projectRoot, ".env") });

const app = express();
const port = Number(process.env.PORT) || 3001;
const configuredStorage = process.env.STORAGE_DIR || path.join(process.cwd(), "storage");
const storageRoot = path.isAbsolute(configuredStorage)
  ? configuredStorage
  : path.resolve(projectRoot, configuredStorage);
const temporaryDirectory = path.join(storageRoot, ".landrive-tmp");
const upload = multer({
  storage: multer.diskStorage({
    destination: temporaryDirectory,
    filename: (_request, _file, callback) => callback(null, crypto.randomUUID())
  })
});

function parseRelativePath(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw Object.assign(new Error("Invalid folder path."), { status: 400 });
  }

  const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const segments = normalized ? normalized.split("/") : [];
  if (segments.some((segment) =>
    !segment || segment === "." || segment === ".." || segment === ".landrive-tmp"
  )) {
    throw Object.assign(new Error("Invalid folder path."), { status: 400 });
  }
  return segments;
}

async function getDirectory(segments) {
  let current = storageRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const info = await fs.lstat(current).catch((error) => {
      if (error.code === "ENOENT") {
        throw Object.assign(new Error("Folder not found."), { status: 404 });
      }
      throw error;
    });
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw Object.assign(new Error("Folder not found."), { status: 404 });
    }
  }
  return current;
}

function getFileName(originalName) {
  const fileName = path.posix.basename(originalName.replaceAll("\\", "/"));
  if (!fileName || fileName === "." || fileName === ".." || fileName === ".landrive-tmp") {
    throw Object.assign(new Error("Invalid file name."), { status: 400 });
  }
  return fileName;
}

function getLanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((address) =>
      address &&
      address.family === "IPv4" &&
      !address.internal &&
      !address.address.startsWith("169.254.")
    )
    .map((address) => address.address);
}

app.get("/api/network", (_request, response) => {
  response.json({ addresses: getLanAddresses() });
});

app.get("/api/files", async (request, response, next) => {
  try {
    const segments = parseRelativePath(request.query.path ?? "");
    const directory = await getDirectory(segments);
    const items = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(items
      .filter((item) =>
        item.name !== ".landrive-tmp" &&
        item.name !== ".DS_Store" &&
        (item.isDirectory() || item.isFile())
      )
      .map(async (item) => {
        const info = await fs.lstat(path.join(directory, item.name));
        return {
          name: item.name,
          type: item.isDirectory() ? "folder" : "file",
          size: item.isFile() ? info.size : null,
          modifiedAt: info.mtime.toISOString()
        };
      }));
    files.sort((left, right) => {
      if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
    });
    response.json({ path: segments.join("/"), files });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/files", async (request, response, next) => {
  try {
    const segments = parseRelativePath(request.query.path ?? "");
    if (!segments.length) {
      throw Object.assign(new Error("Choose a file or folder to delete."), { status: 400 });
    }

    const name = segments.pop();
    const parent = await getDirectory(segments);
    const target = path.join(parent, name);
    const info = await fs.lstat(target).catch((error) => {
      if (error.code === "ENOENT") {
        throw Object.assign(new Error("File or folder not found."), { status: 404 });
      }
      throw error;
    });
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
      throw Object.assign(new Error("This item cannot be deleted."), { status: 400 });
    }

    await fs.rm(target, { recursive: info.isDirectory() });
    response.json({ deleted: name, type: info.isDirectory() ? "folder" : "file" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/folders", express.json(), async (request, response, next) => {
  try {
    const parentSegments = parseRelativePath(request.body?.path ?? "");
    const name = request.body?.name;
    if (typeof name !== "string" || !name.trim() || name.trim() !== name ||
        name === "." || name === ".." || name.includes("/") || name.includes("\\") ||
        name.includes("\0") || name === ".landrive-tmp") {
      throw Object.assign(new Error("Enter a valid folder name."), { status: 400 });
    }
    const parent = await getDirectory(parentSegments);
    try {
      await fs.mkdir(path.join(parent, name));
    } catch (error) {
      if (error.code === "EEXIST") {
        throw Object.assign(new Error(`A file or folder named "${name}" already exists.`), { status: 409 });
      }
      throw error;
    }
    response.status(201).json({ name });
  } catch (error) {
    next(error);
  }
});

app.post("/api/files/upload", upload.single("file"), async (request, response, next) => {
  try {
    if (!request.file) {
      throw Object.assign(new Error("Choose a file to upload."), { status: 400 });
    }
    const segments = parseRelativePath(request.query.path ?? "");
    const directory = await getDirectory(segments);
    const name = getFileName(request.file.originalname);
    const destination = path.join(directory, name);

    try {
      await fs.link(request.file.path, destination);
    } catch (error) {
      if (error.code === "EEXIST") {
        throw Object.assign(new Error(`A file or folder named "${name}" already exists.`), { status: 409 });
      }
      throw error;
    }
    await fs.rm(request.file.path, { force: true });
    response.status(201).json({ name, size: request.file.size });
  } catch (error) {
    if (request.file?.path) await fs.rm(request.file.path, { force: true }).catch(() => {});
    next(error);
  }
});

app.get("/api/files/download", async (request, response, next) => {
  try {
    const segments = parseRelativePath(request.query.path ?? "");
    if (!segments.length) {
      throw Object.assign(new Error("Choose a file to download."), { status: 400 });
    }
    const name = segments.pop();
    const parent = await getDirectory(segments);
    const filePath = path.join(parent, name);
    const info = await fs.lstat(filePath).catch((error) => {
      if (error.code === "ENOENT") {
        throw Object.assign(new Error("File not found."), { status: 404 });
      }
      throw error;
    });
    if (!info.isFile() || info.isSymbolicLink()) {
      throw Object.assign(new Error("File not found."), { status: 404 });
    }
    response.download(filePath, name);
  } catch (error) {
    next(error);
  }
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API endpoint not found. Restart Yogi LanDrive if this is unexpected." });
});

app.use(express.static(path.join(projectRoot, "dist")));
app.get("*", (_request, response, next) => {
  response.sendFile(path.join(projectRoot, "dist", "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((error, _request, response, _next) => {
  const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(error);
  response.status(status).json({
    error: status >= 500 ? "The server could not complete the request." : error.message
  });
});

await fs.mkdir(storageRoot, { recursive: true });
const storageInfo = await fs.lstat(storageRoot);
if (storageInfo.isSymbolicLink() || !storageInfo.isDirectory()) {
  throw new Error("STORAGE_DIR must resolve to a real directory, not a symbolic link.");
}
await fs.mkdir(temporaryDirectory, { recursive: true });
const temporaryInfo = await fs.lstat(temporaryDirectory);
if (temporaryInfo.isSymbolicLink() || !temporaryInfo.isDirectory()) {
  throw new Error("The upload temporary directory must be a real directory.");
}

const server = http.createServer(app);
server.listen(port, "0.0.0.0", () => {
  console.log(`Yogi LanDrive is listening on port ${port}.`);
  const addresses = getLanAddresses();
  if (addresses.length) {
    for (const address of addresses) console.log(`Open http://${address}:${port}`);
  } else {
    console.log("No local IPv4 address found; connect using this laptop's network address.");
  }
});
