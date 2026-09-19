import { readLoreJspf } from "./reader.mjs";

const form = document.querySelector("form");
const sourceInput = document.querySelector("#source");
const fileInput = document.querySelector("#file");
const message = document.querySelector("#message");
const output = document.querySelector("#output");

function render(jspfDocument) {
  const collection = readLoreJspf(jspfDocument);
  output.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = collection.title;
  output.append(heading);

  if (collection.annotation) {
    const annotation = document.createElement("p");
    annotation.textContent = collection.annotation;
    output.append(annotation);
  }

  const summary = document.createElement("p");
  const unresolved = collection.entries.filter((entry) => entry.status === "unresolved").length;
  summary.className = "summary";
  summary.textContent = `${collection.entries.length} entries · ${unresolved} unresolved`;
  output.append(summary);

  const list = document.createElement("ol");
  for (const entry of collection.entries) {
    const item = document.createElement("li");
    item.className = entry.status;

    const position = document.createElement("span");
    position.className = "position";
    position.textContent = String(entry.position);

    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = entry.title ?? "Unavailable entry";
    const detail = document.createElement("small");
    detail.textContent = entry.artist ?? entry.unavailableReason ?? "Identity not resolved";
    text.append(title, detail);

    const status = document.createElement("span");
    status.className = "status";
    status.textContent = entry.status;
    item.append(position, text, status);
    list.append(item);
  }
  output.append(list);
}

async function load() {
  message.textContent = "Reading JSPF…";
  try {
    let payload;
    const file = fileInput.files?.[0];
    if (file) {
      payload = JSON.parse(await file.text());
    } else {
      const source = sourceInput.value.trim();
      if (!source) throw new Error("Enter a public .jspf URL or choose a JSPF file.");
      const response = await fetch(source);
      if (!response.ok) throw new Error(`The collection returned HTTP ${response.status}.`);
      payload = await response.json();
    }
    render(payload);
    message.textContent = "Read independently from JSPF. Source order retained.";
  } catch (error) {
    output.replaceChildren();
    message.textContent = error instanceof Error ? error.message : "Could not read this JSPF.";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void load();
});

const initialSource = new URLSearchParams(location.search).get("src");
if (initialSource) {
  sourceInput.value = initialSource;
  void load();
}
