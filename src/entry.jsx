import React from "react";
import { createRoot } from "react-dom/client";
import App from "../fitness_coach.jsx";

window.__App = App;
window.__mountApp = (el) => createRoot(el).render(React.createElement(App));
