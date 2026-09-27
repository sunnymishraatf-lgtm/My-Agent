import React, { useEffect, useState } from "react";

export default function Profile() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user));
  }, []);
  return <div><h1>Profile</h1>{user && <p>{user.email}</p>}</div>;
}
