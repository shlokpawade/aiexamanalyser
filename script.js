// ===============================================
//  AI EXAM ANALYZER – FINAL PREMIUM VERSION 🚀
// ===============================================

const WORKER_URL = "https://steep-rain-8637.pawadeshlok.workers.dev/";

window.latestAIOutput = "";
let startTime = 0;

// PDF.js worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.worker.min.js";
}

// ===============================================
// UI
// ===============================================
function updateLoading(text, progress) {
  const box = document.getElementById("loadingContainer");
  box.classList.remove("hidden");

  const timeElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  document.getElementById("loadingText").innerText =
    `${text} (${timeElapsed}s)`;

  document.getElementById("progressFill").style.width =
    Math.min(progress, 100) + "%";
}

// ===============================================
// OCR
// ===============================================
async function extractPDFText(file) {
  let finalText = "";

  const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;

  for (let i = 1; i <= pdf.numPages; i++) {
    updateLoading(`📷 OCR page ${i}/${pdf.numPages}`, 5 + (i / pdf.numPages) * 25);

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const { data: { text } } = await Tesseract.recognize(canvas, "eng");

    finalText += "\n\n" + text;
  }

  return finalText;
}

// ===============================================
// CHUNKING
// ===============================================
function splitIntoChunks(text) {
  const size = 800;
  let chunks = [];

  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }

  return chunks;
}

// ===============================================
// 🔥 IMPROVED PROMPT (NO HALLUCINATION)
// ===============================================
function buildChunkPrompt(chunkText, index, total) {
  return `
You are analyzing REAL exam paper content.

STRICT RULES:
- ONLY extract questions present in the text
- DO NOT create or guess anything
- Ignore headings like "Attempt any 2"
- Extract only meaningful exam questions
- If nothing found → say "No valid questions found"

TEXT:
${chunkText}

Return:

Chunk ${index}/${total}

Questions:
- ...

Repeated:
- ...

Topics:
- ...
`;
}

// ===============================================
// 🔥 MERGE + PREDICTION FEATURE
// ===============================================
function buildMergePrompt(chunkAnalyses) {
  return `
You are combining analysis of exam papers.

STRICT RULES:
- DO NOT add new questions
- ONLY use given data
- Remove duplicates
- Identify most repeated patterns

Return:

📌 Final Questions:
- ...

🔁 Repeated Questions:
- ...

🧩 Important Topics:
- ...

🎯 Predicted Questions (VERY IMPORTANT):
- (Top likely exam questions based on repetition)

🗓️ Study Plan:
- What to focus
- What to skip

DATA:
${chunkAnalyses.join("\n")}
`;
}

// ===============================================
// API CALL
// ===============================================
async function callWorker(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: prompt }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) throw new Error("Server error");

    const data = await res.json();

    if (data.error) throw new Error(data.error);

    return data.output;

  } catch (err) {
    console.log("⚠️ Skipped chunk");
    return "⚠️ Skipped due to timeout";
  }
}

// ===============================================
// MAIN
// ===============================================
async function analyze() {
  const files = document.getElementById("fileInput").files;
  const output = document.getElementById("output");

  if (!files.length) {
    alert("Upload files");
    return;
  }

  startTime = Date.now();
  updateLoading("🚀 Starting...", 2);

  let text = "";

  for (let f of files) {
    text += await extractPDFText(f);
  }

  // LIMIT TEXT
  if (text.length > 6000) {
    text = text.slice(0, 6000);
  }

  const chunks = splitIntoChunks(text);
  let results = [];

  for (let i = 0; i < chunks.length; i++) {
    updateLoading(`✨ Chunk ${i + 1}/${chunks.length}`, 30 + (i / chunks.length) * 40);

    const res = await callWorker(
      buildChunkPrompt(chunks[i], i + 1, chunks.length)
    );

    results.push(res);
  }

  updateLoading("🧠 Generating predictions...", 85);

  const final = await callWorker(buildMergePrompt(results));

  output.innerHTML = marked.parse(final);
  updateLoading("✅ Done", 100);
}

// ===============================================
// EVENTS
// ===============================================
document.getElementById("analyzeBtn").onclick = () => {
  analyze().catch(err => {
    document.getElementById("output").innerHTML =
      `<div class='error'>❌ ${err.message}</div>`;
  });
};
