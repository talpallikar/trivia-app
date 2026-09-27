import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Display from "./routes/Display";
import Grade from "./routes/Grade";
import Host from "./routes/Host";
import Play from "./routes/Play";
import "./styles.css";

function route() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  switch (path) {
    case "/display":
      document.body.classList.add("is-display");
      return <Display />;
    case "/host":
      return <Host />;
    case "/grade":
      return <Grade />;
    case "/play":
      return <Play />;
    default:
      // "/" (and anything unknown) is the player route; keep the URL tidy for bookmarking.
      window.history.replaceState(null, "", "/play" + window.location.search);
      return <Play />;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{route()}</StrictMode>,
);
