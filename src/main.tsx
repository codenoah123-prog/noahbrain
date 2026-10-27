import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import HostedApp from "./HostedApp";
const RootApp = import.meta.env.MODE === "cloudflare" ? HostedApp : App;
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);
