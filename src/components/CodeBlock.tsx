"use client";

import { useEffect, useRef } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-java";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-bash";

export default function CodeBlock({ code, language }: { code: string; language?: string }) {
  const ref = useRef<HTMLElement>(null);
  const lang = (language || "javascript").toLowerCase();

  useEffect(() => {
    if (ref.current) Prism.highlightElement(ref.current);
  }, [code, lang]);

  return (
    <pre className="rounded-lg overflow-x-auto text-sm !bg-[#1e1e2e] p-4">
      <code ref={ref} className={`language-${lang}`}>
        {code}
      </code>
    </pre>
  );
}
