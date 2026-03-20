import { useEffect, useState } from "react";
import { getConfig, getOrCreateSessionId, getStoredApiKey, setStoredApiKey } from "./api/client";
import { AnalyzePage } from "./pages/AnalyzePage";
import { PromptPage } from "./pages/PromptPage";
import { cn } from "./lib/utils";

type Tab = "prompt" | "analyze";

export default function App() {
  const [tab, setTab] = useState<Tab>("prompt");
  const [dark, setDark] = useState(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [demoMode, setDemoMode] = useState(false);
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [showKey, setShowKey] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    getConfig()
      .then((cfg) => setDemoMode(cfg.demo_mode))
      .catch(() => {});
  }, []);

  // Best-effort: wipe this session's runs when the tab closes.
  useEffect(() => {
    if (!demoMode) return;
    const sessionId = getOrCreateSessionId();
    const handler = () => {
      navigator.sendBeacon(`/api/runs/session/${sessionId}/clear`);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [demoMode]);

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Demo mode banner */}
      {demoMode && (
        <div className="bg-green-500 text-white text-xs text-center py-1.5 px-4">
          DEMO MODE &mdash;{" "}
          <a
            href="https://github.com/oconnoob/llm-comparator-pub"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
          >
            view source on GitHub
          </a>
        </div>
      )}
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              LLM Comparator
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Compare model outputs side-by-side
            </p>
          </div>
          <div className="flex items-center gap-2">
            {demoMode && (
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setStoredApiKey(e.target.value);
                    }}
                    placeholder="sk-…"
                    className="text-xs w-44 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 pr-7 focus:outline-none focus:ring-2 focus:ring-green-400 dark:focus:ring-green-600 placeholder:text-gray-300 dark:placeholder:text-gray-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer text-xs"
                    aria-label={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? "🙈" : "👁"}
                  </button>
                </div>
                {apiKey && (
                  <span className="text-xs text-green-600 dark:text-green-400">✓</span>
                )}
                <a
                  href="https://cloud.digitalocean.com/registrations/new?utm_source=online&utm_medium=devrel&utm_campaign=llm-comparator"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-green-600 dark:text-green-400 hover:underline whitespace-nowrap"
                >
                  Get a key
                </a>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowInfo((s) => !s)}
                    className="w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400 text-[10px] leading-none flex items-center justify-center cursor-pointer transition-colors"
                    aria-label="API key info"
                  >
                    i
                  </button>
                  {showInfo && (
                    <div className="absolute right-0 top-6 z-50 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
                      <p className="font-medium text-gray-800 dark:text-gray-100 mb-1">DigitalOcean Serverless Inference</p>
                      <p className="mb-2">This demo uses Serverless Inference — pay-per-token access to leading open-source models with no infrastructure to manage.</p>
                      <p className="text-gray-500 dark:text-gray-400">Your API key is stored in your browser&apos;s local storage and is only transmitted to make inference requests on your behalf.</p>
                      <button
                        type="button"
                        onClick={() => setShowInfo(false)}
                        className="mt-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            <button
              onClick={() => setDark((d) => !d)}
              className="text-xs px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              aria-label="Toggle dark mode"
            >
              {dark ? "☀ Light" : "☽ Dark"}
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <nav className="flex gap-6" role="tablist">
            {(["prompt", "analyze"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "pb-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer",
                  tab === t
                    ? "border-green-500 text-green-600 dark:text-green-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300",
                )}
              >
                {t === "prompt" ? "⚡ Prompt" : "📊 Analyze"}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {tab === "prompt" ? (
          <PromptPage
            demoMode={demoMode}
            apiKey={apiKey}
            onNeedApiKey={() => setShowApiKeyModal(true)}
          />
        ) : (
          <AnalyzePage
            demoMode={demoMode}
            apiKey={apiKey}
            onNeedApiKey={() => setShowApiKeyModal(true)}
          />
        )}
      </main>

      {/* API key required modal */}
      {showApiKeyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowApiKeyModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
              API key required
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
              This demo uses DigitalOcean Serverless Inference. To run generations and analyses, you&apos;ll need a DigitalOcean API key — paste it into the <span className="font-medium">API Key</span> field in the header.
            </p>
            <a
              href="https://cloud.digitalocean.com/registrations/new?utm_source=online&utm_medium=devrel&utm_campaign=llm-comparator"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center text-xs font-medium px-4 py-2 rounded-md bg-green-500 hover:bg-green-600 text-white transition-colors mb-2"
            >
              Get an API key
            </a>
            <button
              type="button"
              onClick={() => setShowApiKeyModal(false)}
              className="block w-full text-center text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
