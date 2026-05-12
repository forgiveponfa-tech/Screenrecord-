import { Switch, Route } from "wouter";
import Home from "./pages/Home";
import Cast from "./pages/Cast";
import View from "./pages/View";
import Dashboard from "./pages/Dashboard";
import Session from "./pages/Session";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/cast" component={Cast} />
      <Route path="/view" component={View} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/session/:id" component={Session} />
      <Route>
        <div className="min-h-screen flex items-center justify-center text-gray-400 font-mono">
          404 — Page not found
        </div>
      </Route>
    </Switch>
  );
}
