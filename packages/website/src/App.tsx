import { LandingPage } from "~/components/landing-page";

export default function App() {
  return (
    <LandingPage
      title={
        <>
          Orchestrate local AI coding agents.
          <br />
          <span className="text-emerald-400">From anywhere.</span>
        </>
      }
      subtitle="A personal Web & CLI environment for running, monitoring, and controlling AI coding agents directly on your machines. Multi-provider, self-hosted, and end-to-end encrypted."
    />
  );
}
