/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IAuthenticationService } from '../../authentication/common/authentication';
import { IFetcherService } from '../../networking/common/fetcherService';
import { GithubRepositoryItem, IGithubRepositoryService } from '../common/githubService';

export class GithubRepositoryService implements IGithubRepositoryService {

	declare readonly _serviceBrand: undefined;

	private readonly githubRepositoryInfoCache = new Map<string, { id: number }>();

	constructor(
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
	) {
	}

	private async _doGetRepositoryInfo(owner: string, repo: string) {
		const authToken: string | undefined = this._authenticationService.permissiveGitHubSession?.accessToken ?? this._authenticationService.anyGitHubSession?.accessToken;
		const headers: Record<string, string> = {
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		};
		if (authToken) {
			headers['Authorization'] = `Bearer ${authToken}`;
		}
		// cache this based on creation info
		return this._fetcherService.fetch(`https://api.github.com/repos/${owner}/${repo}`, { method: 'GET', headers });
	}

	async getRepositoryInfo(owner: string, repo: string) {
		const cachedInfo = this.githubRepositoryInfoCache.get(`${owner}/${repo}`);
		if (cachedInfo) {
			return cachedInfo;
		}

		const response = await this._doGetRepositoryInfo(owner, repo);
		if (response.ok) {
			const repoInfo = await response.json();
			this.githubRepositoryInfoCache.set(`${owner}/${repo}`, repoInfo);
			return repoInfo;
		}
		throw new Error(`Failed to fetch repository info for ${owner}/${repo}`);
	}

	async isAvailable(org: string, repo: string): Promise<boolean> {
		try {
			const response = await this._doGetRepositoryInfo(org, repo);
			return response.ok;
		} catch (e) {
			return false;
		}
	}

	async getRepositoryItems(org: string, repo: string, path: string): Promise<GithubRepositoryItem[]> {
		const paths: GithubRepositoryItem[] = [];
		try {
			const authToken = this._authenticationService.permissiveGitHubSession?.accessToken;
			const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');

			const response = await this._fetcherService.fetch(`https://api.github.com/repos/${org}/${repo}/contents/${encodedPath}`, {
				method: 'GET',
				headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Authorization': `Bearer ${authToken}` }
			});

			if (response.ok) {
				const data = (await response.json());
				if (Array.isArray(data)) {
					for (const child of data) {
						if ('name' in child && 'path' in child && 'type' in child && 'html_url' in child) {
							paths.push({ name: child.name, path: child.path, type: child.type, html_url: child.html_url });
							if (child.type === 'dir') {
								paths.push(...await this.getRepositoryItems(org, repo, child.path));
							}
						}
					}
				}
			} else {
				console.error(`Failed to fetch contents from ${org}:${repo}:${path}`);
				return [];
			}
		} catch {
			console.error(`Failed to fetch contents from ${org}:${repo}:${path}`);
			return [];
		}
		return paths;
	}

	async getRepositoryItemContent(org: string, repo: string, path: string): Promise<Uint8Array | undefined> {
		try {
			const authToken = this._authenticationService.permissiveGitHubSession?.accessToken;
			const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
			const response = await this._fetcherService.fetch(`https://api.github.com/repos/${org}/${repo}/contents/${encodedPath}`, {
				method: 'GET',
				headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Authorization': `Bearer ${authToken}` }
			});
			if (response.ok) {

				const data = (await response.json());

				if ('content' in data) {
					const content = Buffer.from(data.content, 'base64');
					return new Uint8Array(content);
				}
				throw new Error('Unexpected data from GitHub');
			}
		} catch {
			console.error(`Failed to contents from ${org}:${repo}:${path}`);
		}
	}
}
