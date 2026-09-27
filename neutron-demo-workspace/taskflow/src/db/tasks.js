const tasks = [];

async function listByUser(ownerId) {
  return tasks.filter((t) => t.ownerId === ownerId);
}

async function insert({ ownerId, title }) {
  const task = { id: tasks.length + 1, ownerId, title, done: false, createdAt: new Date().toISOString() };
  tasks.push(task);
  return task;
}

module.exports = { listByUser, insert };
