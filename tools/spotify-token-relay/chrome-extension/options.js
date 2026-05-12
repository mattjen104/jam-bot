const $ = (id) => document.getElementById(id);

function load() {
  chrome.storage.local.get(
    ["relayUrl", "relaySecret", "lastStatus", "lastStatusDetail", "lastStatusAt"],
    (s) => {
      $("relayUrl").value = s.relayUrl || "";
      $("relaySecret").value = s.relaySecret || "";
      const status = s.lastStatus || "pending";
      const cls =
        status === "ok" ? "ok" : status === "error" ? "err" : "pending";
      $("status").textContent = status;
      $("status").className = cls;
      $("detail").textContent = s.lastStatusDetail || "(none yet)";
      $("when").textContent = s.lastStatusAt
        ? new Date(s.lastStatusAt).toLocaleString()
        : "(never)";
    },
  );
}

$("save").addEventListener("click", () => {
  const relayUrl = $("relayUrl").value.trim().replace(/\/+$/, "");
  const relaySecret = $("relaySecret").value.trim();
  chrome.storage.local.set({ relayUrl, relaySecret }, () => {
    $("save").textContent = "Saved";
    setTimeout(() => ($("save").textContent = "Save"), 1500);
  });
});

chrome.storage.onChanged.addListener(load);
load();
