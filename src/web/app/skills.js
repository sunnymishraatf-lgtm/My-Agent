/* NEUTRON Skills — browser for the curated Hermes Agent skill library.
 *
 * The 124 portable skills (Nous Research Hermes Agent, MIT) are published as
 * static files (public/skills/) by scripts/copy-skills-web.mjs, so this works
 * on the serverless deployment with no backend: search the index, read any
 * playbook. The autonomous agent (Node server) uses the same library through
 * its read_skill tool.
 */
(function (root) {
  "use strict";

  var indexCache = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function loadIndex() {
    if (indexCache) return Promise.resolve(indexCache);
    return fetch("/skills/index.json", { cache: "force-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("skills index not found");
        return r.json();
      })
      .then(function (idx) {
        indexCache = idx;
        return idx;
      });
  }

  function renderSkills(view) {
    view.innerHTML = "";
    var wrap = el("div", "skills-wrap");
    var head = el("div", "skills-head");
    head.appendChild(el("h1", null, "Skills"));
    head.appendChild(el("p", "skills-sub",
      "124 expert playbooks from the Hermes Agent project (Nous Research, MIT) — " +
      "code review, debugging, testing, research, devops and more. " +
      "The autonomous agent loads these with its read_skill tool; you can read them here."));
    var search = el("input", "input skills-search");
    search.placeholder = "Search skills… (e.g. code review, docker, testing)";
    search.setAttribute("aria-label", "Search skills");
    head.appendChild(search);
    wrap.appendChild(head);

    var status = el("p", "muted", "Loading skills…");
    wrap.appendChild(status);
    var grid = el("div", "skills-grid");
    wrap.appendChild(grid);
    var reader = el("div", "skills-reader hidden");
    wrap.appendChild(reader);
    view.appendChild(wrap);

    var all = [];
    function paintList(q) {
      grid.innerHTML = "";
      var query = (q || "").trim().toLowerCase();
      var list = all.filter(function (s) {
        if (!query) return true;
        return s.name.toLowerCase().indexOf(query) !== -1 ||
               s.description.toLowerCase().indexOf(query) !== -1;
      });
      status.textContent = list.length + " of " + all.length + " skills";
      if (!list.length) {
        grid.appendChild(el("p", "muted", "No skills match."));
        return;
      }
      list.slice(0, 120).forEach(function (s) {
        var card = el("button", "skill-card");
        card.type = "button";
        card.appendChild(el("div", "skill-name", s.name));
        card.appendChild(el("div", "skill-desc", s.description));
        card.onclick = function () { openSkill(s); };
        grid.appendChild(card);
      });
      if (list.length > 120) {
        grid.appendChild(el("p", "muted small", "Showing first 120 — refine your search."));
      }
    }

    function openSkill(s) {
      reader.innerHTML = "";
      reader.classList.remove("hidden");
      var bar = el("div", "skills-reader-bar");
      var back = el("button", "btn sm", "← All skills");
      back.onclick = function () {
        reader.classList.add("hidden");
        reader.innerHTML = "";
        grid.scrollIntoView();
      };
      bar.appendChild(back);
      bar.appendChild(el("strong", "skill-reader-title", s.name));
      reader.appendChild(bar);
      var body = el("div", "skill-body", "Loading…");
      reader.appendChild(body);
      reader.scrollIntoView();
      fetch("/skills/" + encodeURIComponent(s.file), { cache: "force-cache" })
        .then(function (r) {
          if (!r.ok) throw new Error("not found");
          return r.text();
        })
        .then(function (md) {
          // Strip the YAML frontmatter for display.
          if (md.indexOf("---") === 0) {
            var end = md.indexOf("\n---", 3);
            if (end !== -1) md = md.slice(end + 4);
          }
          body.innerHTML = "";
          var NSU = root.NeutronUI;
          if (NSU && NSU.renderMarkdown) {
            var tmp = document.createElement("div");
            tmp.innerHTML = NSU.renderMarkdown(md);
            body.appendChild(tmp);
          } else {
            body.appendChild(el("pre", null, md));
          }
        })
        .catch(function () {
          body.textContent = "Couldn't load this skill.";
        });
    }

    var deb = null;
    search.addEventListener("input", function () {
      if (deb) clearTimeout(deb);
      deb = setTimeout(function () { paintList(search.value); }, 150);
    });

    loadIndex()
      .then(function (idx) {
        all = idx;
        paintList("");
      })
      .catch(function () {
        status.textContent = "Skills aren't published in this build yet.";
      });
  }

  function teardown() {
    // Nothing persistent: fetches are one-shot.
  }

  root.NeutronSkills = { renderSkills: renderSkills, teardown: teardown };
})(typeof window !== "undefined" ? window : globalThis);
