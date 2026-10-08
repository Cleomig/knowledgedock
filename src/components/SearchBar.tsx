'use client';

import { useState, FormEvent } from 'react';
import { Search, X } from 'lucide-react';

interface SearchResult {
  content: string;
  similarity: number;
  title: string;
}

interface SearchBarProps {
  onResults?: (results: SearchResult[]) => void;
  onLoading?: (loading: boolean) => void;
}

export default function SearchBar({ onResults, onLoading }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim() || isSearching) return;

    setIsSearching(true);
    onLoading?.(true);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      onResults?.(data.results ?? []);
    } catch {
      onResults?.([]);
    } finally {
      setIsSearching(false);
      onLoading?.(false);
    }
  }

  return (
    <form onSubmit={handleSearch} className="flex gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar en documentos..."
          disabled={isSearching}
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Buscar en documentos"
        />
      </div>
      <button
        type="submit"
        disabled={isSearching || !query.trim()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        {isSearching ? '...' : 'Buscar'}
      </button>
    </form>
  );
}
