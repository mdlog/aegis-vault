// Vitest setup — runs before each test file.
//
// Provides minimal DOM polyfills + common globals so React 19 + jsdom play nice
// with wagmi/viem hooks under test.

import { vi } from 'vitest';

// jsdom doesn't ship matchMedia; some Tailwind / responsive code calls it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom doesn't ship IntersectionObserver
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  window.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
