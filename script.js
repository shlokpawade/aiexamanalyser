// ===============================================
//  AI EXAM ANALYZER – FRONTEND (AUTO-CHUNK + MERGE)
// ===============================================

// 🔗 Your Cloudflare Worker URL
const WORKER_URL = "https://steep-rain-8637.pawadeshlok.workers.dev/"; // change if needed

// Store latest raw AI markdown output for WhatsApp sharing
window.latestAIOutput = "";

// 🔧 PDF.js worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.worker.min.js";
}

// ===============================================
//  UI HELPERS
// ===============================================
function updateLoading(text, progress) {
  const box = document.getElementById("loadingContainer");
  box.classList.remove("hidden");
  document.getElementById("loadingText").innerText = text;
  document.getElementById("progressFill").style.width =
    Math.min(progress, 100) + "%";
}

// ===============================================
//  PDF → IMAGE → OCR TEXT (for scanned PDFs)
// ===============================================
async function extractPDFText(file) {
  let finalText = "";

  const loadingTask = pdfjsLib.getDocument(URL.createObjectURL(file));
  const pdf = await loadingTask.promise;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    updateLoading(
      `📷 OCR: ${file.name} – page ${pageNum}/${pdf.numPages}…`,
      5 + (pageNum / pdf.numPages) * 30
    );

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    // OCR this page
    const { data: { text } } = await Tesseract.recognize(
      canvas,
      "eng",
      { logger: (m) => console.log(m) }
    );

    finalText += "\n\n" + text;
  }

  return finalText.trim();
}

// ===============================================
//  CHUNKING LOGIC (AUTO: 1–4 CHUNKS)
// ===============================================
function splitIntoChunks(fullText) {
  const len = fullText.length;

  let chunksCount;
  if (len < 12000) chunksCount = 1;
  else if (len < 24000) chunksCount = 2;
  else if (len < 36000) chunksCount = 3;
  else chunksCount = 4;

  const size = Math.ceil(len / chunksCount);
  const chunks = [];

  let start = 0;
  for (let i = 0; i < chunksCount; i++) {
    let end = start + size;
    if (end > len) end = len;

    let slice = fullText.slice(start, end);
    const lastNewline = slice.lastIndexOf("\n");
    if (lastNewline > 200 && i !== chunksCount - 1) {
      slice = fullText.slice(start, start + lastNewline);
      end = start + lastNewline;
    }

    chunks.push(slice.trim());
    start = end;
  }

  return chunks;
}

// ===============================================
//  PROMPTS
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
//  CALL CLOUDFLARE WORKER
// ===============================================
async function callWorker(prompt, label = "analysis") {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: prompt }),
  });

  const data = await response.json();

  if (data.error) {
    console.error("Worker error (" + label + "):", data.error);
    throw new Error(data.error);
  }

  return data.output || "";
}

// ===============================================
//  EXTRACT "MOST REPEATED QUESTIONS" FOR WHATSAPP
// ===============================================
function extractRepeatedQuestions(markdownText) {
  const lines = markdownText.split("\n");

  const startIndex = lines.findIndex((line) =>
    line.toLowerCase().includes("most repeated questions")
  );

  if (startIndex === -1) return null;

  let extracted = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("##")) break; // next section → stop
    if (
      line.startsWith("-") ||
      line.startsWith("•") ||
      line.startsWith("*")
    ) {
      extracted.push(line);
    }
  }

  return extracted.length ? extracted.join("\n") : null;
}

// ===============================================
//  MAIN ANALYZE FUNCTION
// ===============================================
async function analyze() {
  const files = document.getElementById("fileInput").files;
  const outputBox = document.getElementById("output");

  if (!files.length) {
    alert("Please upload 3–5 PDF papers first!");
    return;
  }

  outputBox.innerHTML = "";
  updateLoading("Starting OCR + analysis…", 3);

  let combinedText = "";

  const fileArray = Array.from(files);
  for (let i = 0; i < fileArray.length; i++) {
    const f = fileArray[i];
    updateLoading(
      `Processing file ${i + 1}/${fileArray.length}: ${f.name}`,
      5 + (i / fileArray.length) * 20
    );

    const text = await extractPDFText(f);
    combinedText += `\n\n===== PAPER: ${f.name} =====\n\n${text}`;
  }

  if (!combinedText.trim()) {
    outputBox.innerHTML =
      "<div class='error'>❌ OCR produced no readable text. Check PDF quality.</div>";
    updateLoading("Error ❌", 100);
    return;
  }

  // 2) Split into auto chunks
  const chunks = splitIntoChunks(combinedText);
  const totalChunks = chunks.length;

  console.log("Total chunks:", totalChunks);

  // 3) Analyze each chunk separately
  const chunkAnalyses = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunkPrompt = buildChunkPrompt(chunks[i], i + 1, totalChunks);
    const progress = 30 + ((i + 1) / totalChunks) * 40;
    updateLoading(
      `✨ Analyzing chunk ${i + 1}/${totalChunks} with AI…`,
      progress
    );

    const result = await callWorker(chunkPrompt, `chunk-${i + 1}`);
    chunkAnalyses.push(result);
  }

  // 4) Merge all chunk analyses using AI
  updateLoading("🧠 Merging all analyses into final report…", 85);
  const mergePrompt = buildMergePrompt(chunkAnalyses);
  const finalOutput = await callWorker(mergePrompt, "merge");

  // Save raw AI output for WhatsApp share
  window.latestAIOutput = finalOutput;

  // 5) Display final result
  document.querySelector(".results-title").classList.remove("hidden");

  const html = marked.parse(finalOutput, { breaks: true, gfm: true });
  outputBox.innerHTML = html;

  updateLoading("Done ✔", 100);
}

// ===============================================
//  EVENT: ANALYZE BUTTON
// ===============================================
document.getElementById("analyzeBtn").addEventListener("click", () => {
  analyze().catch((err) => {
    console.error(err);
    document.getElementById("output").innerHTML =
      "<div class='error'>❌ " + err.message + "</div>";
    updateLoading("Error ❌", 100);
  });
});

// ===============================================
//  EVENT: WHATSAPP SHARE
// ===============================================
document.getElementById("shareWhatsApp").addEventListener("click", () => {
  const rawOutput = window.latestAIOutput || "";

  if (!rawOutput) {
    alert("Please generate the analysis first!");
    return;
  }

  const repeatedSection = extractRepeatedQuestions(rawOutput);

  if (!repeatedSection) {
    alert("Could not find 'Most Repeated Questions' section.");
    return;
  }

  const message = 
`📚 *Most Repeated Questions (AI Extracted)*

${repeatedSection}

🔍 Get full AI exam analysis (important topics, study plan, repeated questions):
Upload your papers here ➜ https://aiexamanalyzer.online/`;

  const encoded = encodeURIComponent(message);
  window.open("https://wa.me/?text=" + encoded, "_blank");
});
