// ===============================================
//  AI EXAM ANALYZER – FINAL POLISH (PROMPTS SAME)
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
// UI HELPERS
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

  const loadingTask = pdfjsLib.getDocument(URL.createObjectURL(file));
  const pdf = await loadingTask.promise;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    updateLoading(
      `📷 OCR: ${file.name} – page ${pageNum}/${pdf.numPages}`,
      5 + (pageNum / pdf.numPages) * 30
    );

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const { data: { text } } = await Tesseract.recognize(canvas, "eng");

    finalText += "\n\n" + text;
  }

  return finalText.trim();
}

// ===============================================
// 🔥 FIXED CHUNKING
// ===============================================
function splitIntoChunks(fullText) {
  const MAX_CHUNK_SIZE = 1800;

  const chunks = [];
  let start = 0;

  while (start < fullText.length) {
    let end = start + MAX_CHUNK_SIZE;

    if (end > fullText.length) end = fullText.length;

    let slice = fullText.slice(start, end);

    const lastNewline = slice.lastIndexOf("\n");
    if (lastNewline > 200 && end !== fullText.length) {
      slice = fullText.slice(start, start + lastNewline);
      end = start + lastNewline;
    }

    chunks.push(slice.trim());
    start = end;
  }

  return chunks;
}

// ===============================================
// PROMPTS (UNCHANGED 🔒)
// ===============================================
function buildChunkPrompt(chunkText, index, total) {
  return `
You are an expert exam-paper analyst.

This is **chunk ${index}/${total}** of a question paper.  
Your job is to extract **REAL QUESTIONS ONLY**, NOT headings.

⚠️ VERY IMPORTANT RULES:
- IGNORE section headings like:
  - "Q.1 (20 Marks)"
  - "Solve any Four"
  - "Attempt any Two"
  - "Q.2 Short Notes"
- Extract ONLY the **actual sub-questions**, e.g.:
  - "Explain DBMS architecture"
  - "What is normalization?"
  - "Define 3NF"
- If you see a heading → skip it.
- If you see sub-questions (a, b, c, 1, 2, 3) → treat each one as an independent question.

Your tasks for THIS CHUNK ONLY:

1. Extract all REAL QUESTIONS  
2. Identify repeated or similar questions  
3. Identify repeated topics  
4. Mark each important question  
5. Give mini study hints  

Return the result in this format:

---
## 📌 Summary (Chunk ${index}/${total})
- Difficulty Level:
- Unique Real Questions Found:
- Topics Found:

## 🔁 Real Repeated Questions (Chunk ${index}/${total})
- …

## 🧩 Repeated Topics (Chunk ${index}/${total})
- …

## ⭐ Important Questions (Chunk ${index}/${total})
- Very Important:
  - …
- Important:
  - …
- Good to Know:
  - …

## 🎯 Study Hints (Chunk ${index}/${total})
- …
---

Here is the chunk text:

${chunkText}
`;
}

function buildMergePrompt(chunkAnalyses) {
  return `
You are merging multiple partial analyses of the SAME exam papers.

VERY IMPORTANT RULES:
- Do NOT include headings like:
  - "Q.1 (20 Marks)"
  - "Solve any Four"
  - "Attempt any Two"
- Only include ACTUAL sub-questions found in the chunks.

Your tasks:

1. Merge REAL extracted questions from all chunks  
2. Combine duplicates (even if wording differs slightly)  
3. Identify total repeated questions  
4. Identify true repeated topics  
5. Produce clear difficulty analysis  
6. Create final study plan  
7. DO NOT invent anything not found in the chunks  

Return final result in exactly this format:

---
## 📌 Summary
- Difficulty Level:
- Total Real Questions Analyzed:
- Total Topics Identified:

## 🔁 Most Repeated Questions
- Actual Question (x times)
- …

## 🧩 Most Repeated Topics
- Topic Name – xx%  
- …

## ⭐ Most Important Questions
- Very Important:
  - …
- Important:
  - …
- Good to Know:
  - …

## 🎯 What to Study to Pass
- Essential Topics:
  - …
- Optional but Helpful:
  - …

## 🗓️ Study Plan
**1-Day Plan:**
- …

**3-Day Plan:**
- …

**7-Day Plan:**
- …
---

Here are the partial analyses:

${chunkAnalyses.map((txt, i) => `\n\n===== CHUNK ANALYSIS ${i + 1} =====\n${txt}`).join("")}
`;
}

// ===============================================
// API CALL (TIMEOUT SAFE)
// ===============================================
async function callWorker(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: prompt }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error("Server error");
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    return data.output || "";

  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("⏳ Request timeout (reduce file size)");
    }
    throw err;
  }
}

// ===============================================
// MAIN ANALYSIS
// ===============================================
async function analyze() {
  const files = document.getElementById("fileInput").files;
  const outputBox = document.getElementById("output");

  if (!files.length) {
    alert("Please upload 3–5 PDF papers first!");
    return;
  }

  startTime = Date.now();

  outputBox.innerHTML = "";
  updateLoading("🚀 Starting analysis...", 2);

  let combinedText = "";

  for (let i = 0; i < files.length; i++) {
    const text = await extractPDFText(files[i]);
    combinedText += `\n\n===== PAPER: ${files[i].name} =====\n\n${text}`;
  }

  const chunks = splitIntoChunks(combinedText);
  const results = [];

  for (let i = 0; i < chunks.length; i++) {
    const percent = 30 + ((i + 1) / chunks.length) * 40;

    updateLoading(
      `✨ Analyzing chunk ${i + 1}/${chunks.length}`,
      percent
    );

    const res = await callWorker(
      buildChunkPrompt(chunks[i], i + 1, chunks.length)
    );

    results.push(res);
  }

  updateLoading("🧠 Merging results...", 85);

  const final = await callWorker(buildMergePrompt(results));

  window.latestAIOutput = final;

  document.querySelector(".results-title").classList.remove("hidden");

  const html = marked.parse(final, { breaks: true, gfm: true });
  outputBox.innerHTML = html;

  updateLoading("✅ Completed!", 100);
}

// ===============================================
// EVENTS
// ===============================================
document.getElementById("analyzeBtn").addEventListener("click", () => {
  analyze().catch((err) => {
    console.error(err);
    document.getElementById("output").innerHTML =
      `<div class='error'>❌ ${err.message}</div>`;
    updateLoading("Error ❌", 100);
  });
});
