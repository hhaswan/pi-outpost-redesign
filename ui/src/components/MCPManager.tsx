import React from 'react';

export function MCPManager({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">MCP Servers</h2>
        <div className="mb-6 text-zinc-600 dark:text-zinc-400">
          MCP Manager is under construction.
        </div>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white transition-opacity"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}