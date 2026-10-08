import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import Dashboard from "./Dashboard";
import CallPage from "./CallPage";
import PayPage from "./PayPage";

const page = window.location.pathname;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{page.startsWith("/call") ? <CallPage /> : page.startsWith("/pay") ? <PayPage /> : <Dashboard />}</StrictMode>,
);
