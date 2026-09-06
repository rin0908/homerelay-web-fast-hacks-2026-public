import Link from "next/link";

import { LoginForm } from "@/app/login/LoginForm";
import { login } from "@/app/login/actions";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { HeartHandshake, ShieldCheck } from "@/components/Icons";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "メールアドレスまたはパスワードをご確認ください。",
  membership: "招待された世帯メンバーであることを確認できませんでした。",
  unavailable: "現在ログインを確認できません。しばらくしてからお試しください。",
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  const configured = isSupabaseConfigured();
  const errorCode = firstValue(parameters.error);
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] : undefined;
  const loggedOut = firstValue(parameters.loggedOut) === "1";

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl px-5 py-6 sm:px-8 sm:py-10">
      {!configured ? <DemoModeBanner /> : null}

      <header className="mt-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white">
          <HeartHandshake aria-hidden="true" size={29} strokeWidth={1.8} />
        </span>
        <p className="eyebrow mt-5">HOMERELAY</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-[var(--color-heading)]">
          招待済みメンバーのログイン
        </h1>
        <p className="mt-3 text-base text-[var(--color-secondary)]">
          ご家族・ご親族・担当の訪問ヘルパーとして招待された方だけが利用できます。
        </p>
      </header>

      <section className="soft-card mt-7 p-5 sm:p-8" aria-labelledby="login-form-title">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#edf5f1] text-[var(--color-primary)]">
            <ShieldCheck aria-hidden="true" size={22} />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-heading)]" id="login-form-title">
              ログイン情報
            </h2>
            <p className="mt-1 text-sm text-[var(--color-secondary)]">
              公開サインアップはありません。受け取った招待情報をご利用ください。
            </p>
          </div>
        </div>

        {loggedOut ? (
          <p className="mt-5 rounded-xl bg-[#edf5f1] p-3 text-sm font-semibold text-[var(--color-primary)]" role="status">
            ログアウトしました。
          </p>
        ) : null}
        {errorMessage ? (
          <p className="mt-5 rounded-xl bg-[#fff4e7] p-3 text-sm font-semibold text-[#85572f]" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {configured ? (
          <LoginForm action={login} />
        ) : (
          <div className="mt-6">
            <p className="text-sm text-[var(--color-secondary)]">
              合成デモでは認証サービスに接続せず、架空データだけを表示します。
            </p>
            <Link className="secondary-button mt-5 w-full" href="/">
              合成デモへ戻る
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
