import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "../app/globals.css";
import { PortalClient } from "../app/PortalClient";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PortalClient />
  </React.StrictMode>,
);
