import { Navigate } from "react-router";

export function redirectTo(path: string, replace = false) {
  return function RedirectTo() {
    return <Navigate to={path} replace={replace} />;
  };
}
