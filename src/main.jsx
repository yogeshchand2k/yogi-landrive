import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; size >= 1024 && index < units.length; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${unit}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

async function readJson(response, fallbackMessage) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("The server returned a web page instead of API data. Restart Yogi LanDrive and try again.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || fallbackMessage);
  return result;
}

function Icon({ name, size = 20 }) {
  const paths = {
    drive: <><path d="m8.2 3 4-0.1 7 12.2-2 3.5H6.9l-2-3.5z" /><path d="m4.9 15.1 3.3-5.8M12.2 3l3.4 5.9m-8.7 9.7h6.8" /></>,
    folder: <><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /></>,
    file: <><path d="M6 3.5h7l5 5v12H6z" /><path d="M13 3.5v5h5M9 13h6m-6 3h6" /></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5" /><path d="M5 14v5h14v-5" /></>,
    plus: <><path d="M12 5v14m-7-7h14" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    download: <><path d="M12 4v11m-5-5 5 5 5-5" /><path d="M5 16v4h14v-4" /></>,
    trash: <><path d="M4 7h16m-10 4v6m4-6v6M5 7l1 13h12l1-13M9 7V4h6v3" /></>,
    moon: <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function App() {
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("yogi-drive-theme");
    return savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
  });
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dropWarning, setDropWarning] = useState("");
  const [transfers, setTransfers] = useState([]);
  const [networkAddress, setNetworkAddress] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const inputRef = useRef(null);
  const transferTimersRef = useRef(new Map());
  const uploadRequestsRef = useRef(new Map());
  const dragDepthRef = useRef(0);
  const dropWarningTimerRef = useRef(null);

  useEffect(() => () => {
    for (const timer of transferTimersRef.current.values()) window.clearTimeout(timer);
    if (dropWarningTimerRef.current) window.clearTimeout(dropWarningTimerRef.current);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("yogi-drive-theme", theme);
  }, [theme]);

  useEffect(() => {
    fetch("/api/network")
      .then(async (response) => {
        const result = await readJson(response, "Could not load the local IP address.");
        setNetworkAddress(result.addresses[0] || "");
      })
      .catch(() => {
        const hostname = window.location.hostname;
        if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
          setNetworkAddress(hostname);
        }
      });
  }, []);

  async function loadFiles(signal) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/files?path=${encodeURIComponent(currentPath)}`, { signal });
      const result = await readJson(response, "Could not load this folder.");
      setFiles(result.files);
    } catch (loadError) {
      if (loadError.name !== "AbortError") setError(loadError.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadFiles(controller.signal);
    return () => controller.abort();
  }, [currentPath]);

  async function createFolder() {
    const name = window.prompt("Name this new folder");
    if (name === null) return;
    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath, name })
      });
      await readJson(response, "Could not create the folder.");
      await loadFiles();
    } catch (folderError) {
      setError(folderError.message);
    }
  }

  function dismissTransferSoon(transferId) {
    const previousTimer = transferTimersRef.current.get(transferId);
    if (previousTimer) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      setTransfers((items) => items.filter((item) => item.id !== transferId));
      transferTimersRef.current.delete(transferId);
    }, 2500);
    transferTimersRef.current.set(transferId, timer);
  }

  function cancelUpload(transferId) {
    uploadRequestsRef.current.get(transferId)?.abort();
  }

  function uploadFile(file) {
    return new Promise((resolve) => {
      const transferId = `${Date.now()}-${Math.random()}`;
      setTransfers((items) => [...items, { id: transferId, name: file.name, progress: 0, status: "uploading" }]);
      const request = new XMLHttpRequest();
      let settled = false;
      const finish = (status, succeeded, error = "") => {
        if (settled) return;
        settled = true;
        uploadRequestsRef.current.delete(transferId);
        setTransfers((items) => items.map((item) =>
          item.id === transferId
            ? { ...item, progress: status === "complete" ? 100 : item.progress, status, error }
            : item));
        dismissTransferSoon(transferId);
        resolve(succeeded);
      };
      uploadRequestsRef.current.set(transferId, request);
      request.open("POST", `/api/files/upload?path=${encodeURIComponent(currentPath)}`);
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setTransfers((items) => items.map((item) =>
            item.id === transferId ? { ...item, progress } : item));
        }
      });
      request.addEventListener("load", () => {
        if (settled) return;
        let result;
        try {
          result = JSON.parse(request.responseText);
        } catch {
          result = {};
        }
        const succeeded = request.status >= 200 && request.status < 300;
        finish(succeeded ? "complete" : "error", succeeded, succeeded ? "" : result.error || "Upload failed.");
      });
      request.addEventListener("error", () => {
        finish("error", false, "Network error during upload.");
      });
      request.addEventListener("abort", () => {
        finish("cancelled", false);
      });
      const body = new FormData();
      body.append("file", file);
      request.send(body);
    });
  }

  async function uploadFiles(selected) {
    if (!selected.length) return;
    for (const file of selected) await uploadFile(file);
    await loadFiles();
  }

  async function handleFilesSelected(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    await uploadFiles(selected);
  }

  function handleDragEnter(event) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function handleDragOver(event) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }

  async function handleDrop(event) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);

    const droppedItems = Array.from(event.dataTransfer.items || []);
    const containsFolder = droppedItems.some((item) => item.webkitGetAsEntry?.()?.isDirectory);
    if (containsFolder) {
      setDropWarning("Folder uploads are not supported. Drop individual files instead.");
      if (dropWarningTimerRef.current) window.clearTimeout(dropWarningTimerRef.current);
      dropWarningTimerRef.current = window.setTimeout(() => {
        setDropWarning("");
        dropWarningTimerRef.current = null;
      }, 2800);
      return;
    }

    await uploadFiles(Array.from(event.dataTransfer.files || []));
  }

  function downloadFile(filePath) {
    window.location.href = `/api/files/download?path=${encodeURIComponent(filePath)}`;
  }

  async function deleteItem(file) {
    const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
    const confirmation = file.type === "folder"
      ? `Permanently delete "${file.name}" and everything inside it? This cannot be undone.`
      : `Permanently delete "${file.name}"? This cannot be undone.`;
    if (!window.confirm(confirmation)) return;

    try {
      const response = await fetch(`/api/files?path=${encodeURIComponent(filePath)}`, { method: "DELETE" });
      await readJson(response, `Could not delete "${file.name}".`);
      await loadFiles();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  const pathParts = currentPath ? currentPath.split("/") : [];
  const totalItems = files.length;
  const visibleTransfer = transfers.find((transfer) => transfer.status === "uploading") ||
    transfers[transfers.length - 1];

  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-closed"}`}
      onDragEnter={handleDragEnter} onDragOver={handleDragOver}
      onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDraggingFiles && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-prompt">
            <Icon name="upload" size={28} />
            <strong>Drop files to upload</strong>
            <span>Files will be added to this folder</span>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand-group">
          <button className="sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)}
            aria-label={`${sidebarOpen ? "Close" : "Open"} sidebar`}
            aria-expanded={sidebarOpen} aria-controls="app-sidebar"
            title={`${sidebarOpen ? "Close" : "Open"} sidebar`}>
            <Icon name="menu" size={21} />
          </button>
          <a className="brand" href="/" aria-label="Yogi Drive home" onClick={(event) => {
            event.preventDefault();
            setCurrentPath("");
          }}>
            <span className="brand-mark"><Icon name="drive" size={23} /></span>
            <span>Yogi Drive</span>
          </a>
        </div>
        {visibleTransfer && (
          <section className="transfer-toast" aria-label="File transfer" aria-live="polite">
            <div className="transfer-info">
              <div className="transfer-label">
                <span title={visibleTransfer.name}>{visibleTransfer.name}</span>
                <span>{visibleTransfer.status === "uploading" ? `${visibleTransfer.progress}%` :
                  visibleTransfer.status === "complete" ? "Done" :
                  visibleTransfer.status === "cancelled" ? "Cancelled" : "Failed"}</span>
              </div>
              <div className="progress-track"><div className={`progress-fill ${visibleTransfer.status}`}
                style={{ width: `${visibleTransfer.progress}%` }} /></div>
              {visibleTransfer.error && <small className="transfer-error">{visibleTransfer.error}</small>}
            </div>
            {visibleTransfer.status === "uploading" && (
              <button className="cancel-upload" onClick={() => cancelUpload(visibleTransfer.id)}
                aria-label={`Cancel upload of ${visibleTransfer.name}`} title="Cancel upload">
                <Icon name="close" size={16} />
              </button>
            )}
          </section>
        )}
        <div className="header-actions">
          <button className="theme-toggle" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>
            <Icon name={theme === "light" ? "moon" : "sun"} size={19} />
          </button>
          <div className="network-pill">
            <span className="online-dot" />
            {networkAddress
              ? <a href={`http://${networkAddress}${window.location.port ? `:${window.location.port}` : ""}`}
                  title={`Open http://${networkAddress}${window.location.port ? `:${window.location.port}` : ""}`}>
                  {networkAddress}{window.location.port ? `:${window.location.port}` : ""}
                </a>
              : "Local IP unavailable"}
          </div>
        </div>
      </header>

      <aside className="sidebar" id="app-sidebar">
        <button className="upload-button" onClick={() => inputRef.current?.click()}>
          <Icon name="upload" size={19} /><span>Upload files</span>
        </button>
        <button className={`nav-item ${currentPath === "" ? "selected" : ""}`} onClick={() => setCurrentPath("")}>
          <Icon name="drive" size={19} /><span>My files</span>
        </button>
        <div className="sidebar-note">
          <div className="note-icon"><Icon name="grid" size={17} /></div>
          <strong>Shared on your Wi-Fi</strong>
          <p>Files here are available to anyone connected to this local network.</p>
        </div>
      </aside>

      <main className="main-content">
        <div className="content-heading">
          <div>
            <div className="breadcrumbs" aria-label="Folder path">
              <button onClick={() => setCurrentPath("")}>My files</button>
              {pathParts.map((part, index) => {
                const targetPath = pathParts.slice(0, index + 1).join("/");
                return (
                  <React.Fragment key={targetPath}>
                    <Icon name="chevron" size={15} />
                    <button className={index === pathParts.length - 1 ? "current-crumb" : ""}
                      onClick={() => setCurrentPath(targetPath)}>{part}</button>
                  </React.Fragment>
                );
              })}
            </div>
            <p className="item-count">{loading ? "Loading files…" : `${totalItems} ${totalItems === 1 ? "item" : "items"}`}</p>
          </div>
            <button className="new-folder-button" onClick={createFolder}>
              <Icon name="plus" size={18} /><span>New folder</span>
            </button>
          </div>

          {(error || dropWarning) && (
            <div className="notice error-notice" role="alert">{error || dropWarning}</div>
          )}
          <section className="file-card">
          <div className="table-heading">
            <span>Name</span><span>Last modified</span><span>File size</span><span />
          </div>
          {loading ? (
            <div className="empty-state"><div className="spinner" /><p>Loading your files</p></div>
          ) : files.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Icon name="folder" size={28} /></div>
              <strong>This folder is empty</strong>
              <p>Upload files or create a folder to get started.</p>
              <button className="empty-upload" onClick={() => inputRef.current?.click()}>
                <Icon name="upload" size={17} /> Upload files
              </button>
            </div>
          ) : files.map((file) => {
            const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
            return (
              <div className="file-row" key={filePath}>
                <button className="file-name" onClick={() => file.type === "folder"
                  ? setCurrentPath(filePath) : downloadFile(filePath)}>
                  <span className={`file-icon ${file.type}`}><Icon name={file.type === "folder" ? "folder" : "file"} size={19} /></span>
                  <span className="file-label">{file.name}</span>
                </button>
                <span className="file-date">{formatDate(file.modifiedAt)}</span>
                <span className="file-size">{file.type === "folder" ? "—" : formatSize(file.size)}</span>
                <div className="row-actions">
                  {file.type === "file" && (
                    <button className="row-action row-download" onClick={() => downloadFile(filePath)}
                      aria-label={`Download ${file.name}`} title="Download">
                      <Icon name="download" size={18} />
                    </button>
                  )}
                  <button className="row-action row-delete" onClick={() => deleteItem(file)}
                    aria-label={`Delete ${file.type} ${file.name}`} title="Delete">
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      </main>
      <input ref={inputRef} className="visually-hidden" type="file" multiple onChange={handleFilesSelected} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
