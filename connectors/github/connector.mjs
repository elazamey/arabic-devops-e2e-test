import { GitHubProvider } from "../../providers/github.mjs";
import { ConnectorError } from "../contracts.mjs";

export class GitHubConnector {
  constructor({ token, baseUrl = "https://api.github.com", fetchImpl = fetch }) {
    this.id = "github";
    this.name = "GitHub";
    this.version = "1.0.0";
    this.capabilities = Object.freeze(["github:read", "github:write", "github:pr:merge"]);
    this.provider = new GitHubProvider({ token, baseUrl, fetchImpl });
  }

  async authenticate() {
    return { authenticated: Boolean(this.provider.token), credential: "github" };
  }

  async health() {
    return { ok: Boolean(this.provider.token), connector: this.id };
  }

  request(path, options) {
    return this.provider.request(path, options);
  }

  getRepository(repository) { return this.provider.getRepository(repository); }
  getBranch(repository, branch) { return this.provider.getBranch(repository, branch); }
  getPullRequest(repository, number) { return this.provider.getPullRequest(repository, number); }
  getChecks(repository, sha) { return this.provider.getCheckRuns(repository, sha); }
  createBranch(repository, branch, sha) { return this.provider.createBranch(repository, branch, sha); }
  createPullRequest(repository, input) { return this.provider.createPullRequest(repository, input); }
  commentPullRequest(repository, number, body) { return this.provider.commentPullRequest(repository, number, body); }
  mergePullRequest(repository, number) { return this.provider.mergePullRequest(repository, number); }

  async execute(operation, input) {
    try {
      switch (operation) {
        case "get_repository": return this.getRepository(input.repository);
        case "get_branch": return this.getBranch(input.repository, input.branch);
        case "get_pull_request": return this.getPullRequest(input.repository, input.number);
        case "get_checks": return this.getChecks(input.repository, input.sha);
        case "create_branch": return this.createBranch(input.repository, input.branch, input.sha);
        case "create_pull_request": return this.createPullRequest(input.repository, input);
        case "comment_pull_request": return this.commentPullRequest(input.repository, input.number, input.body);
        case "merge_pull_request": return this.mergePullRequest(input.repository, input.number);
        default: throw new ConnectorError(`GitHub operation غير معروفة: ${operation}`, { status: 400, code: "UNKNOWN_OPERATION" });
      }
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(error.message, { status: error.status || 502, code: "GITHUB_ERROR", cause: error });
    }
  }

  async close() {}
}
