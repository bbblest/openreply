import Link from "next/link";

export const SERVICE_NAME = "自動回信系統";
export const SUPPORT_EMAIL = "yes@good01.tw";

interface LegalShellProps {
  title: string;
  description: string;
  updatedAt: string;
  children: React.ReactNode;
}

export default function LegalShell({
  title,
  description,
  updatedAt,
  children,
}: LegalShellProps) {
  return (
    <main lang="zh-Hant" className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3">
            <span>
              <span className="block text-lg font-bold text-foreground">{SERVICE_NAME}</span>
              <span className="block text-xs text-muted">OpenReply 自架服務</span>
            </span>
          </Link>
          <Link
            href="/login"
            className="text-sm font-semibold text-muted transition hover:text-foreground"
          >
            登入後台
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-5 py-14">
        <p className="text-sm font-semibold uppercase text-accent">
          最後更新：{updatedAt}
        </p>
        <h1 className="mt-4 text-4xl font-black text-foreground sm:text-5xl">
          {title}
        </h1>
        <p className="mt-5 text-base leading-8 text-muted">{description}</p>
        <div className="mt-10 space-y-8 text-sm leading-7 text-foreground">
          {children}
        </div>
      </article>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl space-y-4 px-5 py-8 text-sm text-muted">
          <nav aria-label="服務資訊" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="hover:text-foreground">隱私權說明</Link>
            <Link href="/terms" className="hover:text-foreground">服務條款</Link>
            <Link href="/data-deletion" className="hover:text-foreground">資料刪除說明</Link>
            <Link href="/meta-review" className="hover:text-foreground">Meta 審查說明</Link>
          </nav>
          <p>
            服務支援與資料刪除申請：{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}
