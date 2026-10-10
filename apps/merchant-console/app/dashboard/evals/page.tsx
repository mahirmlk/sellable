"use client";

import { useState, useEffect, useCallback } from "react";
import { Play } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { formatTimestamp } from "@/lib/formatters";
import {
  listEvalSuites,
  runEvalSuite,
  getEvalRun,
  getEvalDrift,
  type EvalSuiteView,
  type EvalCaseResult,
  type DriftMetric,
} from "@/lib/api";

export default function EvalsPage() {
  const [suites, setSuites] = useState<EvalSuiteView[] | null>(null);
  const [results, setResults] = useState<EvalCaseResult[] | null>(null);
  const [resultsTitle, setResultsTitle] = useState("");
  const [drift, setDrift] = useState<DriftMetric[] | null>(null);
  const [drifted, setDrifted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [suiteData, driftData] = await Promise.all([
        listEvalSuites(),
        getEvalDrift(7, 7),
      ]);
      setSuites(suiteData);
      setDrift(driftData.metrics);
      setDrifted(driftData.drifted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load evaluation");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  const onRun = async (suiteId: string) => {
    setRunning(suiteId);
    setError(null);
    try {
      const report = await runEvalSuite(suiteId);
      const detail = await getEvalRun(report.run_id);
      setResults(detail.results);
      setResultsTitle(`${suiteId}: ${report.passed} passed, ${report.failed} failed`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suite run failed");
    } finally {
      setRunning(null);
    }
  };

  if (loading && !suites) {
    return (
      <div className="px-6 lg:px-8 py-6 space-y-6 max-w-[1200px]">
        <div>
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
            Evaluations
          </div>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
            Evaluations
          </h1>
        </div>
        <TableSkeleton />
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 py-6 space-y-6 max-w-[1200px]">
      <div className="min-w-0">
        <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
          Evaluations
        </div>
        <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
          Evaluations
        </h1>
        <p className="mt-1 max-w-[46rem] text-[13px] leading-relaxed text-muted">
          Versioned suites run on isolated cores, never on merchant data.
          P0 failures block releases.
        </p>
      </div>

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Suites</h2>        {!suites || suites.length === 0 ? (
          <EmptyState title="No suites" message="Seeded suites appear here." />
        ) : (
          <div className="space-y-2">
            {suites.map((suite) => (
              <div
                key={suite.suite_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-panel-2 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">
                    {suite.name}{" "}
                    <span className="text-xs text-muted">
                      {suite.suite_id} · {suite.version} · {suite.cases} cases
                    </span>
                  </div>
                  <div className="text-xs text-muted">{suite.description}</div>
                  {suite.latest_run && (
                    <div className="mt-1 text-xs text-muted">
                      Latest: {suite.latest_run.passed} passed,{" "}
                      {suite.latest_run.failed} failed ·{" "}
                      {formatTimestamp(suite.latest_run.started_at)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void onRun(suite.suite_id)}
                  disabled={running !== null}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-neutral-900 text-xs text-white disabled:opacity-50"
                >
                  <Play size={12} /> {running === suite.suite_id ? "Running…" : "Run"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {results && (
        <section className="border-t border-hairline pt-6">
          <h2 className="mb-3 text-sm font-semibold">{resultsTitle}</h2>
          <div className="space-y-1.5">
            {results.map((result) => (
              <div
                key={result.result_id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                  result.passed
                    ? "border-green-600/20 bg-green-50"
                    : "border-red-600/20 bg-red-50"
                }`}
              >
                <span className="font-mono">{result.case_id}</span>
                <span className="text-muted">
                  {result.passed ? "PASS" : (result.error ?? "FAIL")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="border-t border-hairline pt-6">
        <h2 className="mb-3 text-sm font-semibold">
          Production drift (7d vs prior 7d)
        </h2>
        {!drift || drift.length === 0 ? (
          <EmptyState
            title="No drift data"
            message="Production traffic populates drift signals."
          />
        ) : (
          <div className="space-y-1.5">
            {drifted && (
              <div className="rounded-lg border border-amber-600/20 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Drift detected. Review regressed metrics before releasing.
              </div>
            )}
            {drift.map((metric) => (
              <div
                key={metric.metric}
                className="flex items-center justify-between rounded-lg border border-hairline bg-panel-2 px-3 py-2 text-xs"
              >
                <span className="font-mono">{metric.metric}</span>
                <span className="text-muted">
                  {metric.baseline}, now {metric.current}
                  {metric.drifted ? " · DRIFTED" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
