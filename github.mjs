export class GitHubProvider {
  constructor({ token, baseUrl = "https://api.github.com", fetchImpl = fetch }) {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    if (!this.token) {
      const error = new Error("GITHUB_TOKEN غير مضبوط؛ تم إيقاف اتصال GitHub");
      error.status = 503;
      throw error;
    }
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        ...options.headers
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `GitHub API ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  listRepositories() { return this.request("/user/repos?sort=updated&per_page=30"); }
  getRepository(repository) { return this.request(`/repos/${repository}`); }
  getBranch(repository, branch) { return this.request(`/repos/${repository}/branches/${encodeURIComponent(branch)}`); }
  getPullRequest(repository, number) { return this.request(`/repos/${repository}/pulls/${number}`); }
  getCheckRuns(repository, sha) { return this.request(`/repos/${repository}/commits/${sha}/check-runs`); }
  getBranchProtection(repository, branch) { return this.request(`/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`); }
  createBranch(repository, branch, sha) { return this.request(`/repos/${repository}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }), headers: { "content-type": "application/json" } }); }
  createPullRequest(repository, { title, head, base, body = "" }) { return this.request(`/repos/${repository}/pulls`, { method: "POST", body: JSON.stringify({ title, head, base, body }), headers: { "content-type": "application/json" } }); }
  commentPullRequest(repository, number, body) { return this.request(`/repos/${repository}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }), headers: { "content-type": "application/json" } }); }
  mergePullRequest(repository, number) { return this.request(`/repos/${repository}/pulls/${number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash" }), headers: { "content-type": "application/json" } }); }
}
