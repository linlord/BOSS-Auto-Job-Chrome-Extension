const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("content.js", "utf8");
const backgroundSource = fs.readFileSync("background.js", "utf8");
const failures = [];

function extractFunction(name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Missing function ${name}`);
  }
  const paramsEnd = source.indexOf(")", start);
  const braceStart = source.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

function runTableFunction(functionName, recordsExpression) {
  const fnSource = extractFunction(functionName);
  const headerMatch = source.match(/const TABLE_HEADERS = \[[\s\S]*?\];/);
  if (!headerMatch) throw new Error("Missing TABLE_HEADERS");
  const helperSource = `${headerMatch[0]}\n${extractFunction("tableRow")}\n${fnSource}`;
  const sandbox = {
    state: {
      records: [
        {
          time: "2026-06-18T00:00:00.000Z",
          query: "AI sales",
          result: "已收藏",
          processingStatus: "已收藏",
          recommendedAction: "已自动收藏",
          needsReview: "否",
          mainReason: "匹配",
          ruleVersion: 1,
          score: 88,
          title: "AI销售",
          companyScale: "100-499人",
          cardText: "card",
          hits: "AI",
          negatives: "",
          filterNotes: "",
          reviewNotes: "",
          decisionLog: "decision",
          detailMatched: "是：title",
          detailChanged: "是",
          detailHrefMatched: "否",
          favoriteResult: "收藏成功",
          favoriteButtonText: "已收藏",
          greetingResult: "未开启",
          href: "https://www.zhipin.com/job_detail/abc.html"
        }
      ]
    }
  };
  const code = `
    function actionLabel(action) { return action || ""; }
    function currentCampaignKeywordLabel() { return "AI sales"; }
    function currentCompanyScaleLabel() { return "100-499人"; }
    function norm(text) { return (text || "").replace(/\\s+/g, " ").trim(); }
    ${helperSource}
    result = ${functionName}(${recordsExpression || ""});
  `;
  vm.runInNewContext(code, sandbox);
  return sandbox.result.split("\n").map(row => row.split("\t"));
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    failures.push(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertIncludes(text, expected, message) {
  if (!text.includes(expected)) {
    failures.push(`${message}: missing ${expected}`);
  }
}

const tableRows = runTableFunction("tableText");
assertEqual(tableRows[0].length, tableRows[1].length, "tableText header/data column count");
assertEqual(tableRows[0].indexOf("详情匹配"), tableRows[1].indexOf("是：title"), "tableText detailMatched column");
assertEqual(tableRows[0].indexOf("收藏状态"), tableRows[1].indexOf("收藏成功"), "tableText favoriteResult column");

const filteredRows = runTableFunction("tableTextFor", "state.records");
assertEqual(filteredRows[0].length, filteredRows[1].length, "tableTextFor header/data column count");
assertEqual(filteredRows[0].indexOf("详情匹配"), filteredRows[1].indexOf("是：title"), "tableTextFor detailMatched column");
assertEqual(filteredRows[0].indexOf("收藏状态"), filteredRows[1].indexOf("收藏成功"), "tableTextFor favoriteResult column");

const clickJobCardSource = extractFunction("clickJobCard");
assertIncludes(clickJobCardSource, "preventDefault", "clickJobCard should prevent link navigation");

const startSource = extractFunction("start");
assertIncludes(startSource, "start_blocked_missing_ai_key", "start should block scanning without a saved API key");
assertIncludes(startSource, "aiConfigured()", "start should check AI configuration before scanning");
assertIncludes(startSource, "alertMissingAiKey", "start should show a missing-key popup");

const processJobSource = extractFunction("processJob");
assertIncludes(processJobSource, "judgeJobWithLlm", "processJob should require LLM judgement");
assertIncludes(processJobSource, "llmResult.action", "processJob should use LLM action for the final decision");
assertIncludes(processJobSource, "llmResult.score", "processJob should use LLM score for the final decision");

const scanLoopSource = extractFunction("start");
assertIncludes(scanLoopSource, "err instanceof LlmJudgementError", "scan loop should pause on LLM judgement failure");
assertIncludes(scanLoopSource, "llm_judgement_failed", "scan loop should persist LLM failure state");

const generateSearchKeywordsSource = extractFunction("generateSearchKeywordsFromProfile");
assertIncludes(generateSearchKeywordsSource, "generateSearchKeywordsWithAi", "generate search keywords should call the LLM");
assertIncludes(generateSearchKeywordsSource, "generate_keywords_blocked_missing_ai_key", "generate search keywords should block without API key");
assertIncludes(generateSearchKeywordsSource, "alertMissingAiKey", "generate search keywords should show a missing-key popup");
if (generateSearchKeywordsSource.includes("searchKeywordsFromProfile()")) {
  failures.push("generate search keywords should not fall back to local searchKeywordsFromProfile()");
}
if (generateSearchKeywordsSource.includes("已改用本地规则")) {
  failures.push("generate search keywords should not silently fall back to local rules on LLM failure");
}

const generateRulesSource = extractFunction("generateRulesFromPanelKeywords");
assertIncludes(generateRulesSource, "generateRulesWithAi", "generate rules should call the LLM");
assertIncludes(generateRulesSource, "generate_rules_blocked_missing_ai_key", "generate rules should block without API key");
assertIncludes(generateRulesSource, "alertMissingAiKey", "generate rules should show a missing-key popup");
if (generateRulesSource.includes("ruleWordsFromKeywords(")) {
  failures.push("generate rules should not fall back to local ruleWordsFromKeywords()");
}
if (generateRulesSource.includes("已改用本地规则")) {
  failures.push("generate rules should not silently fall back to local rules on LLM failure");
}

const missingKeyPopupSource = extractFunction("alertMissingAiKey");
assertIncludes(missingKeyPopupSource, "高级规则", "missing-key popup should mention Advanced Rules");
assertIncludes(missingKeyPopupSource, "第三方大模型key", "missing-key popup should mention third-party model key");
assertIncludes(missingKeyPopupSource, "baf-missing-key-modal", "missing-key popup should render an in-panel strong modal");
if (missingKeyPopupSource.includes("window.alert")) {
  failures.push("missing-key popup should not use the browser native alert");
}

const panelSource = extractFunction("createPanel");
assertIncludes(panelSource, "ensureAiKeyBeforeAction", "button handlers should guard missing key before action");
assertIncludes(panelSource, "生成搜索词", "generate keywords button should guard missing key");
assertIncludes(panelSource, "启动或继续扫描", "start button should guard missing key");
assertIncludes(panelSource, "生成加分词/排除词", "generate rules button should guard missing key");
assertIncludes(panelSource, "baf-save-key", "panel should expose a dedicated save key button");
assertIncludes(panelSource, "baf-ai-key-state", "panel should show a visible key save state");
assertIncludes(panelSource, "keydown", "panel should save the key on Enter");
assertIncludes(panelSource, "baf-run-state", "panel header should include a run-state indicator");
assertIncludes(panelSource, "baf-run-dot", "run-state indicator should include a colored dot");
assertIncludes(panelSource, "baf-run-text", "run-state indicator should include responsive text");
assertIncludes(panelSource, "baf-state-running", "run-state indicator should style running state");
assertIncludes(panelSource, "baf-state-complete", "run-state indicator should style complete state");
assertIncludes(panelSource, "baf-state-error", "run-state indicator should style error state");

const saveAiSettingsSource = extractFunction("saveAiSettings");
assertIncludes(saveAiSettingsSource, "storageLocalSet", "saveAiSettings should persist to extension storage");
assertIncludes(saveAiSettingsSource, "return false", "saveAiSettings should report failed persistence");
assertIncludes(saveAiSettingsSource, "return true", "saveAiSettings should report successful persistence");
assertIncludes(source, "function maskApiKey", "code should provide a masked API key display");
assertIncludes(source, "isMaskedApiKey", "code should distinguish masked display from a real typed key");
assertIncludes(saveAiSettingsSource, "maskApiKey(nextApiKey)", "saveAiSettings should display the saved key in masked form");
const updateAiKeyStateSource = extractFunction("updateAiKeyState");
assertIncludes(updateAiKeyStateSource, "!isMaskedApiKey", "masked key display should not be treated as a pending typed key");

assertIncludes(source, "function runStateInfo", "code should compute run-state indicator state");
assertIncludes(source, "updateRunStateIndicator", "code should update run-state indicator");

assertIncludes(backgroundSource, "function extractResponseContent", "background should normalize LLM response content");
assertIncludes(backgroundSource, "choices?.[0]?.text", "background should support text completions response shape");
assertIncludes(backgroundSource, "output_text", "background should support output_text response shape");
assertIncludes(backgroundSource, "extractResponseContent(data)", "background should use normalized response extraction");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("regression checks passed");
