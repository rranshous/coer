/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type tt from 'typescript/lib/tsserverlibrary';
import TS from './typescript';
const ts = TS();

import { FunctionLikeContextComputeRunnable, FunctionLikeContextProvider } from './baseContextProviders';
import { CodeSnippetBuilder } from './code';
import { ComputeCost, ContextComputeRunnable, RecoverableError, Search, type ComputeContextSession, type ContextComputeRunnableCollector, type ContextResult, type ProviderComputeContext, type RequestContext, type SeenSymbols } from './contextProvider';
import { CompletionContextKind, EmitMode, Priorities, SnippetKind, SpeculativeKind, type CacheScope, type Range } from './protocol';
import tss, { ClassDeclarations, Declarations, Symbols, Traversal, type StateProvider, type TokenInfo } from './typescripts';

abstract class ClassPropertyBlueprintSearch<T extends tt.MethodDeclaration | tt.ConstructorDeclaration> extends Search<tt.ClassDeclaration> {

	protected declaration: T;
	protected readonly stateProvider: StateProvider;

	constructor(program: tt.Program, symbols: Symbols, declaration: T, stateProvider: StateProvider) {
		super(program, symbols);
		this.declaration = declaration;
		this.stateProvider = stateProvider;
	}


	public isSame(other: T): boolean {
		return this.declaration === other ||
			(this.declaration.getSourceFile().fileName === other.getSourceFile().fileName && this.declaration.pos === other.pos);
	}

	public score(program: tt.Program, context: RequestContext): number {
		if (program.getSourceFile(this.declaration.getSourceFile().fileName) === undefined) {
			return 0;
		}
		const neighborFiles = context.neighborFiles;
		if (neighborFiles.length === 0) {
			return 1;
		}
		let result = Math.pow(10, neighborFiles.length.toString().length);
		for (const file of neighborFiles) {
			if (program.getSourceFile(file) !== undefined) {
				result += 1;
			}
		}
		return result;
	}
}

abstract class MethodBlueprintSearch extends ClassPropertyBlueprintSearch<tt.MethodDeclaration> {

	constructor(program: tt.Program, symbols: Symbols, declaration: tt.MethodDeclaration, stateProvider: StateProvider) {
		super(program, symbols, declaration, stateProvider);
	}

	public static create(program: tt.Program, symbols: Symbols, declaration: tt.MethodDeclaration, stateProvider: StateProvider): ClassPropertyBlueprintSearch<tt.MethodDeclaration> | undefined {
		const classDeclaration = declaration.parent;
		if (!ts.isClassDeclaration(classDeclaration)) {
			return undefined;
		}
		const isPrivate = Declarations.isPrivate(declaration);
		const typesToCheck: tt.Symbol[] = [];
		let classToCheck: tt.Symbol | undefined = undefined;
		if (!isPrivate) {
			const symbol = symbols.getSymbolAtLocation(classDeclaration.name !== undefined ? classDeclaration.name : classDeclaration);
			if (symbol === undefined || !Symbols.isClass(symbol)) {
				return undefined;
			}
			const name = ts.escapeLeadingUnderscores(declaration.name.getText());
			let path: tt.Symbol[] | undefined = undefined;
			let skip: boolean = false;
			for (const [typeSymbol, superTypeSymbol] of symbols.getAllSuperTypesWithPath(symbol)) {
				if (symbol === typeSymbol) {
					// We start a new path;
					skip = false;
					path = [];
				}
				if (skip) {
					continue;
				}
				path!.push(superTypeSymbol);
				const method = superTypeSymbol.members?.get(name);
				if (method !== undefined) {
					if (Symbols.isInterface(superTypeSymbol) || Symbols.isTypeLiteral(superTypeSymbol)) {
						typesToCheck.push(...path!);
						skip = true;
					} else if (Symbols.isClass(superTypeSymbol)) {
						if (Symbols.isAbstract(method)) {
							// If the method is abstract we check in the same class
							// hierarchy
							classToCheck = superTypeSymbol;
							break;
						} else {
							// Method is not abstract, so the method overrides another
							// method. So we search in the same class hierarchy as well.
							classToCheck = superTypeSymbol;
							break;
						}
					}
				}
			}
		}
		if (isPrivate) {
			const extendsClause = ClassDeclarations.getExtendsClause(classDeclaration);
			if (extendsClause === undefined || extendsClause.types.length === 0) {
				return undefined;
			} else {
				const extendsSymbol = symbols.getLeafSymbolAtLocation(extendsClause.types[0].expression);
				if (extendsSymbol === undefined || !Symbols.isClass(extendsSymbol)) {
					return undefined;
				}
				return new PrivateMethodBlueprintSearch(program, symbols, classDeclaration, extendsSymbol, declaration, stateProvider);
			}
		} else {
			if (classToCheck !== undefined) {
				return new FindMethodInSubclassSearch(program, symbols, classDeclaration, declaration, classToCheck, stateProvider);
			} else if (typesToCheck.length > 0) {
				// the super types we collect contain type literals. Since they can't be referred to by name we
				// can filter them out for the find in hierarchy search. We also filter the symbols that are unnamed.
				const filteredTypesToCheck = typesToCheck.filter((symbol) => {
					if (Symbols.isTypeLiteral(symbol)) {
						return false;
					}
					const name = symbol.escapedName;
					if (name === '__type' || name === '__class') {
						return false;
					}
					return true;
				});
				return new FindMethodInHierarchySearch(program, symbols, classDeclaration, declaration, filteredTypesToCheck, stateProvider);
			} else {
				return undefined;
			}
		}
	}
}

abstract class FindInSiblingClassSearch<T extends tt.MethodDeclaration | tt.ConstructorDeclaration> extends ClassPropertyBlueprintSearch<T> {

	private readonly classDeclaration: tt.ClassDeclaration;
	protected readonly extendsSymbol: tt.Symbol;

	constructor(program: tt.Program, symbols: Symbols, search: FindInSiblingClassSearch<T>);
	constructor(program: tt.Program, symbols: Symbols, classDeclaration: tt.ClassDeclaration, extendsSymbol: tt.Symbol, declaration: T, stateProvider: StateProvider);
	constructor(program: tt.Program, symbols: Symbols, classDeclarationOrSearch: tt.ClassDeclaration | FindInSiblingClassSearch<T>, extendsSymbol?: tt.Symbol, declaration?: T, stateProvider?: StateProvider) {
		if (classDeclarationOrSearch instanceof FindInSiblingClassSearch) {
			const search = classDeclarationOrSearch as FindInSiblingClassSearch<T>;
			const methodDeclaration = Search.getNodeInProgram(program, search.declaration);
			super(program, symbols, methodDeclaration, search.stateProvider);
			this.classDeclaration = Search.getNodeInProgram(program, search.classDeclaration);
			const declarations = search.extendsSymbol.declarations;
			if (declarations === undefined || declarations.length === 0) {
				throw new Error('No declarations found for extends symbol');
			}
			let extendsSymbol: tt.Symbol | undefined;
			for (const declaration of declarations) {
				if (ts.isClassDeclaration(declaration)) {
					const heritageClause = ClassDeclarations.getExtendsClause(declaration);
					if (heritageClause === undefined || heritageClause.types.length === 0) {
						throw new Error('No extends clause found');
					}
					extendsSymbol = this.symbols.getSymbolAtLocation(heritageClause.types[0].expression);
					if (extendsSymbol === undefined || !Symbols.isClass(extendsSymbol)) {
						throw new Error('No extends symbol found');
					}
					break;
				}
			}
			if (extendsSymbol === undefined) {
				throw new Error('No extends symbol found');
			}
			this.extendsSymbol = extendsSymbol;
		} else {
			super(program, symbols, declaration!, stateProvider!);
			this.classDeclaration = classDeclarationOrSearch;
			this.extendsSymbol = extendsSymbol!;
		}
	}

	public run(context: RequestContext, token: tt.CancellationToken): tt.ClassDeclaration | undefined {
		const memberName = this.getMemberName();
		for (const subType of this.symbols.getDirectSubTypes(this.extendsSymbol, context.getPreferredNeighborFiles(this.program), this.stateProvider, token)) {
			token.throwIfCancellationRequested();
			if (subType.members !== undefined) {
				const member = subType.members.get(memberName);
				if (member === undefined) {
					continue;
				}

				const declarations = member.declarations;
				if (declarations === undefined || declarations.length === 0) {
					continue;
				}
				for (const declaration of declarations) {
					if (declaration.kind !== this.declaration.kind) {
						continue;
					}
					const parent = declaration.parent;
					if (!ts.isClassDeclaration(parent) || parent === this.classDeclaration) {
						continue;
					}
					return parent;
				}
			}
		}
		return undefined;
	}

	protected abstract getMemberName(): tt.__String;
}

class PrivateMethodBlueprintSearch extends FindInSiblingClassSearch<tt.MethodDeclaration> {

	constructor(program: tt.Program, symbols: Symbols, search: PrivateMethodBlueprintSearch);
	constructor(program: tt.Program, symbols: Symbols, classDeclaration: tt.ClassDeclaration, extendsSymbol: tt.Symbol, declaration: tt.MethodDeclaration, stateProvider: StateProvider);
	constructor(program: tt.Program, symbols: Symbols, classDeclarationOrSearch: tt.ClassDeclaration | PrivateMethodBlueprintSearch, extendsSymbol?: tt.Symbol, declaration?: tt.MethodDeclaration, stateProvider?: StateProvider) {
		if (classDeclarationOrSearch instanceof PrivateMethodBlueprintSearch) {
			super(program, symbols, classDeclarationOrSearch);
		} else {
			super(program, symbols, classDeclarationOrSearch, extendsSymbol!, declaration!, stateProvider!);
		}
	}

	public with(program: tt.Program): PrivateMethodBlueprintSearch {
		if (program === this.program) {
			return this;
		}
		return new PrivateMethodBlueprintSearch(program, new Symbols(program), this);
	}

	protected getMemberName(): tt.__String {
		return ts.escapeLeadingUnderscores(this.declaration.name.getText());
	}
}

class FindMethodInSubclassSearch extends MethodBlueprintSearch {

	private readonly classDeclaration: tt.ClassDeclaration;
	private readonly startClass: tt.Symbol;

	constructor(program: tt.Program, symbols: Symbols, search: FindMethodInSubclassSearch);
	constructor(program: tt.Program, symbols: Symbols, classDeclaration: tt.ClassDeclaration, declaration: tt.MethodDeclaration, startClass: tt.Symbol, stateProvider: StateProvider);
	constructor(program: tt.Program, symbols: Symbols, classDeclarationOrSearch: tt.ClassDeclaration | FindMethodInSubclassSearch, declaration?: tt.MethodDeclaration, startClass?: tt.Symbol, stateProvider?: StateProvider) {
		if (classDeclarationOrSearch instanceof FindMethodInSubclassSearch) {
			const search = classDeclarationOrSearch as FindMethodInSubclassSearch;
			const declaration = Search.getNodeInProgram(program, search.declaration);
			super(program, symbols, declaration, search.stateProvider);
			this.classDeclaration = Search.getNodeInProgram(program, search.classDeclaration);
			const startClass = search.startClass;
			const declarations = startClass.declarations;
			if (declarations === undefined || declarations.length === 0) {
				throw new RecoverableError('No declarations found for start class', RecoverableError.NoDeclaration);
			}
			let symbol: tt.Symbol | undefined;
			for (const declaration of declarations) {
				if (!ts.isClassDeclaration(declaration)) {
					continue;
				}
				symbol = this.symbols.getSymbolAtLocation(declaration.name ? declaration.name : declaration);
				if (symbol !== undefined) {
					break;
				}
			}
			if (symbol === undefined) {
				throw new RecoverableError('No symbol found for start class', RecoverableError.SymbolNotFound);
			}
			this.startClass = symbol;
		} else {
			super(program, symbols, declaration!, stateProvider!);
			this.classDeclaration = classDeclarationOrSearch;
			this.startClass = startClass!;
		}
	}

	public with(program: tt.Program): FindMethodInSubclassSearch {
		if (program === this.program) {
			return this;
		}
		return new FindMethodInSubclassSearch(program, new Symbols(program), this);
	}

	public run(context: RequestContext, token: tt.CancellationToken): tt.ClassDeclaration | undefined {
		if (!Symbols.isClass(this.startClass)) {
			return undefined;
		}
		const callableName = ts.escapeLeadingUnderscores(this.declaration.name.getText());
		for (const subType of this.symbols.getAllSubTypes(this.startClass, Traversal.breadthFirst, context.getPreferredNeighborFiles(this.program), this.stateProvider, token)) {
			token.throwIfCancellationRequested();
			if (subType.members !== undefined) {
				const member = subType.members.get(callableName);
				if (member === undefined) {
					continue;
				}

				const declarations = member.declarations;
				if (declarations === undefined || declarations.length === 0) {
					continue;
				}
				for (const declaration of declarations) {
					if (!ts.isMethodDeclaration(declaration)) {
						continue;
					}
					const parent = declaration.parent;
					if (!ts.isClassDeclaration(parent) || parent === this.classDeclaration) {
						continue;
					}
					return parent;
				}
			}
		}
		return undefined;
	}
}

class FindMethodInHierarchySearch extends MethodBlueprintSearch {

	private readonly classDeclaration: tt.ClassDeclaration;
	private readonly typesToCheck: tt.Symbol[];

	constructor(program: tt.Program, symbols: Symbols, search: FindMethodInHierarchySearch);
	constructor(program: tt.Program, symbols: Symbols, classDeclaration: tt.ClassDeclaration, declaration: tt.MethodDeclaration, typesToCheck: tt.Symbol[], stateProvider: StateProvider);
	constructor(program: tt.Program, symbols: Symbols, classDeclarationOrSearch: tt.ClassDeclaration | FindMethodInHierarchySearch, declaration?: tt.MethodDeclaration, typesToCheck?: tt.Symbol[], stateProvider?: StateProvider) {
		if (classDeclarationOrSearch instanceof FindMethodInHierarchySearch) {
			const search = classDeclarationOrSearch as FindMethodInHierarchySearch;
			const declaration = Search.getNodeInProgram(program, search.declaration);
			super(program, symbols, declaration, search.stateProvider);
			this.classDeclaration = Search.getNodeInProgram(program, search.classDeclaration);
			const typesToCheck: tt.Symbol[] = [];
			for (const symbolToCheck of search.typesToCheck) {
				const declarations = symbolToCheck.declarations;
				if (declarations === undefined || declarations.length === 0) {
					throw new RecoverableError('No declarations found for start class', RecoverableError.NoDeclaration);
				}
				let symbol: tt.Symbol | undefined;
				for (const declaration of declarations) {
					// todo@dbaeumer We need to check for typedefs as well.
					if (!ts.isClassDeclaration(declaration) && !ts.isInterfaceDeclaration(declaration)) {
						continue;
					}
					symbol = this.symbols.getSymbolAtLocation(declaration.name ? declaration.name : declaration);
					if (symbol !== undefined && symbol.flags === symbolToCheck.flags) {
						break;
					}
				}
				if (symbol === undefined) {
					throw new RecoverableError('No symbol found for start class', RecoverableError.SymbolNotFound);
				}
				typesToCheck.push(symbol);
			}
			this.typesToCheck = typesToCheck;
		} else {
			super(program, symbols, declaration!, stateProvider!);
			this.classDeclaration = classDeclarationOrSearch;
			this.typesToCheck = typesToCheck!;
		}
	}

	public with(program: tt.Program): FindMethodInHierarchySearch {
		if (program === this.program) {
			return this;
		}
		return new FindMethodInHierarchySearch(program, new Symbols(program), this);
	}

	public run(context: RequestContext, token: tt.CancellationToken): tt.ClassDeclaration | undefined {
		const callableName = ts.escapeLeadingUnderscores(this.declaration.name.getText());
		const startSet = new Set<tt.Symbol>(this.typesToCheck);
		const queue: tt.Symbol[] = [];
		// To find a good match we first look at the direct sub types of the types to check. If we find a match
		// we use it. If not we add the type to a queue to check later.
		for (const toCheck of this.typesToCheck) {
			token.throwIfCancellationRequested();
			for (const subType of this.symbols.getDirectSubTypes(toCheck, context.getPreferredNeighborFiles(this.program), this.stateProvider, token)) {
				token.throwIfCancellationRequested();
				if (startSet.has(subType)) {
					continue;
				}
				if (Symbols.isClass(subType)) {
					const member = subType.members?.get(callableName);
					if (member !== undefined && !Symbols.isAbstract(member)) {
						const declaration = ClassDeclarations.fromSymbol(subType);
						if (declaration === this.classDeclaration) {
							continue;
						}
						if (declaration !== undefined) {
							return declaration;
						}
					}
				}
				queue.push(subType);
			}
		}
		// We have not found any match yet. So we look at all the sub types of the types to check.
		const seen: Set<tt.Symbol> = new Set<tt.Symbol>();
		for (const symbol of queue) {
			token.throwIfCancellationRequested();
			if (seen.has(symbol)) {
				continue;
			}
			for (const subType of this.symbols.getAllSubTypes(symbol, Traversal.breadthFirst, context.getPreferredNeighborFiles(this.program), this.stateProvider, token)) {
				token.throwIfCancellationRequested();
				if (seen.has(subType)) {
					continue;
				}
				if (Symbols.isClass(subType)) {
					const member = subType.members?.get(callableName);
					if (member !== undefined && !Symbols.isAbstract(member)) {
						const declaration = ClassDeclarations.fromSymbol(subType);
						if (declaration === this.classDeclaration) {
							seen.add(subType);
							continue;
						}
						if (declaration !== undefined) {
							return declaration;
						}
					}
				}
				seen.add(subType);
			}
			seen.add(symbol);
		}
		return undefined;
	}
}

abstract class SimilarPropertyContextRunnable<T extends tt.MethodDeclaration | tt.ConstructorDeclaration> extends FunctionLikeContextComputeRunnable<T> {

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, declaration: T, priority: number = Priorities.Blueprints) {
		super(session, languageService, context, declaration, priority, ComputeCost.High);
	}

	public override compute(result: ContextResult, token: tt.CancellationToken): void {
		token.throwIfCancellationRequested();
		const search = this.createSearch(token);
		if (search !== undefined) {
			const [program, candidate] = this.session.run(search, this.context, token);
			if (program !== undefined && candidate !== undefined) {
				const symbol = this.symbols.getLeafSymbolAtLocation(candidate.name ? candidate.name : candidate);
				if (symbol === undefined) {
					return;
				}
				const seen = this.getSeenSymbols();
				if (seen.has(symbol)) {
					return;
				}
				const sourceFile = this.declaration.getSourceFile();
				const snippetBuilder = new CodeSnippetBuilder(this.session, this.context.getSymbols(program), sourceFile, seen);
				snippetBuilder.addDeclaration(candidate);
				result.addSnippet(snippetBuilder, SnippetKind.Blueprint, this.priority, SpeculativeKind.emit, undefined);
				seen.add(symbol);
			}
		}
	}

	protected abstract createSearch(token: tt.CancellationToken): Search<tt.ClassDeclaration> | undefined;
}

class SimilarMethodContextRunnable extends SimilarPropertyContextRunnable<tt.MethodDeclaration> {

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, declaration: tt.MethodDeclaration) {
		super(session, languageService, context, declaration);
	}

	protected override createSearch(): Search<tt.ClassDeclaration> | undefined {
		return MethodBlueprintSearch.create(this.getProgram(), this.symbols, this.declaration, this.session);
	}
}

abstract class ClassPropertyContextProvider<T extends tt.MethodDeclaration | tt.ConstructorDeclaration> extends FunctionLikeContextProvider {

	protected readonly declaration: T;
	public override readonly isCallableProvider: boolean;


	constructor(contextKind: CompletionContextKind, symbolsToQuery: tt.SymbolFlags | undefined, declaration: T, tokenInfo: TokenInfo, computeContext: ProviderComputeContext) {
		super(contextKind, symbolsToQuery, declaration, tokenInfo, computeContext);
		this.declaration = declaration;
		this.isCallableProvider = true;
	}

	public override getImportsByCacheRange(): Range | undefined {
		const parent = this.declaration.parent;
		return ts.isClassDeclaration(parent) ? this._getImportsByCacheRange(parent) : undefined;
	}

	protected getTypeExcludes(languageService: tt.LanguageService, context: RequestContext): Set<tt.Symbol> {
		const result = new Set<tt.Symbol>();
		const classDeclaration = this.declaration.parent;
		if (ts.isClassDeclaration(classDeclaration) && classDeclaration.heritageClauses !== undefined && classDeclaration.heritageClauses.length > 0) {
			const program = languageService.getProgram();
			if (program !== undefined) {
				const symbols = context.getSymbols(program);
				for (const heritageClause of classDeclaration.heritageClauses) {
					if (heritageClause.token !== ts.SyntaxKind.ExtendsKeyword) {
						continue;
					}
					for (const type of heritageClause.types) {
						const symbol = symbols.getSymbolAtLocation(type.expression);
						if (symbol !== undefined && Symbols.isClass(symbol)) {
							return result.add(symbol);
						}
					}
				}
			}
		}
		return result;
	}
}

class PropertiesTypeContextRunnable extends ContextComputeRunnable {

	private readonly declaration: tt.MethodDeclaration | tt.ConstructorDeclaration;

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, declaration: tt.MethodDeclaration | tt.ConstructorDeclaration, priority: number = Priorities.Properties) {
		super(session, languageService, context, priority, ComputeCost.Medium);
		this.declaration = declaration;
	}

	public compute(result: ContextResult, token: tt.CancellationToken): void {
		// We could consider object literals here as well. However they don't usually have a this
		// and all things a public in an literal. So we skip them for now.
		const containerDeclaration = this.declaration.parent;
		const isClassDeclaration = ts.isClassDeclaration(containerDeclaration);
		if (!isClassDeclaration) {
			return;
		}
		const program = this.getProgram();
		const symbols = this.context.getSymbols(program);
		const seen = this.getSeenSymbols();
		const methodSymbol = symbols.getSymbolAtLocation(this.declaration.name ? this.declaration.name : this.declaration);
		if (methodSymbol === undefined || !Symbols.isMethod(methodSymbol)) {
			return;
		}
		const containerSymbol = symbols.getSymbolAtLocation(containerDeclaration.name ? containerDeclaration.name : containerDeclaration);
		if (containerSymbol === undefined || !Symbols.isClass(containerSymbol)) {
			return;
		}
		const cacheScope = this.createCacheScope(this.declaration);
		if (containerSymbol.members !== undefined) {
			for (const member of containerSymbol.members.values()) {
				token.throwIfCancellationRequested();
				if (member === methodSymbol) {
					continue;
				}
				if (!this.handleSymbol(result, member, symbols, seen, ts.ModifierFlags.Private | ts.ModifierFlags.Protected, cacheScope)) {
					return;
				}
			}
		}

		for (const type of symbols.getAllSuperClasses(containerSymbol)) {
			token.throwIfCancellationRequested();
			if (type.members === undefined) {
				continue;
			}
			for (const member of type.members.values()) {
				token.throwIfCancellationRequested();
				if (!this.handleSymbol(result, member, symbols, seen, ts.ModifierFlags.Protected, cacheScope)) {
					return;
				}
			}
		}
	}

	private handleSymbol(result: ContextResult, symbol: tt.Symbol, symbols: Symbols, seen: SeenSymbols, flags: tt.ModifierFlags, cacheScope: CacheScope): boolean {
		if (seen.has(symbol) || !Symbols.hasModifierFlags(symbol, flags)) {
			return true;
		}

		const sourceFile = this.declaration.getSourceFile();
		let continueResult: boolean = true;
		for (const [typeSymbol, name] of this.getEmitData(symbol, symbols)) {
			if (typeSymbol === undefined) {
				continue;
			}
			const [handled, cacheInfo] = this.handleSymbolIfCachedOrSeen(result, typeSymbol, EmitMode.ClientBased, cacheScope);
			if (!handled) {
				const snippetBuilder = new CodeSnippetBuilder(this.session, this.symbols, sourceFile, seen);
				snippetBuilder.addTypeSymbol(typeSymbol, name);
				continueResult = continueResult && result.addSnippet(snippetBuilder, SnippetKind.Completion, this.priority, SpeculativeKind.emit, cacheInfo, true);
				seen.add(typeSymbol);
			}
			if (!continueResult) {
				break;
			}
		}
		return continueResult;
	}

	private static readonly NoEmitData: readonly [tt.Symbol | undefined, string | undefined] = Object.freeze<[tt.Symbol | undefined, string | undefined]>([undefined, undefined]);
	private *getEmitData(symbol: tt.Symbol, symbols: Symbols): IterableIterator<readonly [tt.Symbol | undefined, string | undefined]> {
		if (Symbols.isProperty(symbol)) {
			const type = symbols.getTypeChecker().getTypeOfSymbol(symbol);
			const typeSymbol = type.symbol;
			if (typeSymbol === undefined) {
				return;
			}
			let name: string | undefined = undefined;
			const declaration = Symbols.getDeclaration<tt.PropertyDeclaration>(symbol, ts.SyntaxKind.PropertyDeclaration);
			if (declaration !== undefined) {
				if (declaration.type !== undefined) {
					name = tss.Nodes.getTypeName(declaration.type);
				}
			}
			yield [typeSymbol, name];
			return;
		} else if (Symbols.isMethod(symbol)) {
			const type = symbols.getTypeChecker().getTypeOfSymbol(symbol);
			const signatures = type.getCallSignatures();
			if (signatures.length === 0) {
				return;
			}
			for (const signature of signatures) {
				const typeSymbol = signature.getReturnType().symbol;
				if (typeSymbol === undefined) {
					yield PropertiesTypeContextRunnable.NoEmitData;
				}
				let name: string | undefined = undefined;
				const declaration = signature.getDeclaration();
				if (declaration !== undefined) {
					if (declaration.type !== undefined) {
						name = tss.Nodes.getTypeName(declaration.type);
					}
				}
				yield [typeSymbol, name];
			}
		}
		return;
	}
}

export class MethodContextProvider extends ClassPropertyContextProvider<tt.MethodDeclaration> {

	constructor(declaration: tt.MethodDeclaration, tokenInfo: TokenInfo, computeContext: ProviderComputeContext) {
		super(declaration.body === undefined || declaration.body.statements.length === 0 ? CompletionContextKind.WholeMethod : CompletionContextKind.Method, ts.SymbolFlags.Function, declaration, tokenInfo, computeContext);
	}

	public override provide(result: ContextComputeRunnableCollector, session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, token: tt.CancellationToken): void {
		if (session.enableBlueprintSearch()) {
			result.addPrimary(new SimilarMethodContextRunnable(session, languageService, context, this.declaration));
		}
		super.provide(result, session, languageService, context, token);
		result.addSecondary(new PropertiesTypeContextRunnable(session, languageService, context, this.declaration));
	}
}

class ConstructorBlueprintSearch extends FindInSiblingClassSearch<tt.ConstructorDeclaration> {

	constructor(program: tt.Program, symbols: Symbols, search: ConstructorBlueprintSearch);
	constructor(program: tt.Program, symbols: Symbols, classDeclaration: tt.ClassDeclaration, extendsSymbol: tt.Symbol, declaration: tt.ConstructorDeclaration, stateProvider: StateProvider);
	constructor(program: tt.Program, symbols: Symbols, classDeclarationOrSearch: tt.ClassDeclaration | ConstructorBlueprintSearch, extendsSymbol?: tt.Symbol, declaration?: tt.ConstructorDeclaration, stateProvider?: StateProvider) {
		if (classDeclarationOrSearch instanceof ConstructorBlueprintSearch) {
			super(program, symbols, classDeclarationOrSearch);
		} else {
			super(program, symbols, classDeclarationOrSearch, extendsSymbol!, declaration!, stateProvider!);
		}
	}

	public with(program: tt.Program): ConstructorBlueprintSearch {
		if (program === this.program) {
			return this;
		}
		return new ConstructorBlueprintSearch(program, new Symbols(program), this);
	}

	protected getMemberName(): tt.__String {
		return ts.InternalSymbolName.Constructor as tt.__String;
	}
}

class SimilarConstructorContextRunnable extends SimilarPropertyContextRunnable<tt.ConstructorDeclaration> {

	constructor(session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, declaration: tt.ConstructorDeclaration) {
		super(session, languageService, context, declaration);
	}

	protected override createSearch(): Search<tt.ClassDeclaration> | undefined {
		const classDeclaration = this.declaration.parent;
		if (!ts.isClassDeclaration(classDeclaration)) {
			return undefined;
		}

		const extendsClause = ClassDeclarations.getExtendsClause(classDeclaration);
		if (extendsClause === undefined || extendsClause.types.length === 0) {
			return undefined;
		} else {
			const extendsSymbol = this.symbols.getLeafSymbolAtLocation(extendsClause.types[0].expression);
			if (extendsSymbol === undefined || !Symbols.isClass(extendsSymbol)) {
				return undefined;
			}
			return new ConstructorBlueprintSearch(this.getProgram(), this.symbols, classDeclaration, extendsSymbol, this.declaration, this.session);
		}
	}
}

export class ConstructorContextProvider extends ClassPropertyContextProvider<tt.ConstructorDeclaration> {

	constructor(declaration: tt.ConstructorDeclaration, tokenInfo: TokenInfo, computeContext: ProviderComputeContext) {
		super(declaration.body === undefined || declaration.body.statements.length === 0 ? CompletionContextKind.WholeConstructor : CompletionContextKind.Constructor, ts.SymbolFlags.Function, declaration, tokenInfo, computeContext);
	}

	public override provide(result: ContextComputeRunnableCollector, session: ComputeContextSession, languageService: tt.LanguageService, context: RequestContext, token: tt.CancellationToken): void {
		if (session.enableBlueprintSearch()) {
			result.addPrimary(new SimilarConstructorContextRunnable(session, languageService, context, this.declaration));
		}
		super.provide(result, session, languageService, context, token);
	}
}