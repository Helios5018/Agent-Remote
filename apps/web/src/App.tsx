import { useRouter } from "./hooks/useRouter.ts";
import { InboxPage } from "./pages/InboxPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { SessionPage } from "./pages/SessionPage.tsx";
import { WorkspacePage } from "./pages/WorkspacePage.tsx";
import { AppStoreProvider, useAppStore } from "./stores/AppStore.tsx";

function Router() {
  const { session, loading } = useAppStore();
  const { route, navigate, back } = useRouter();

  if (loading) return <div className="boot">加载中…</div>;
  if (!session?.authenticated) return <LoginPage />;

  switch (route.name) {
    case "session":
      return <SessionPage surfaceId={route.surfaceId} back={back} />;
    case "workspace":
      return <WorkspacePage workspaceId={route.workspaceId} navigate={navigate} back={back} />;
    default:
      return <InboxPage navigate={navigate} />;
  }
}

export function App() {
  return (
    <AppStoreProvider>
      <Router />
    </AppStoreProvider>
  );
}
