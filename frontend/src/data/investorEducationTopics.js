// Investor Education content — a graph of concepts organized into four
// "onion" layers (Macro → Market Structure → Asset Classes → Risk &
// Valuation). Each topic has a parent/children (top-down / bottom-up
// drill path) plus lateral `relatedIds` that cross layers, and an optional
// `linkTab` that deep-links to the live tool built for that concept
// elsewhere in the app. Pure data — no component logic here.

export const LAYERS = [
  { id: 'macro',     label: 'Macro & Geography', subtitle: 'Economy → regions → countries → currencies' },
  { id: 'structure', label: 'Market Structure',   subtitle: 'Issuers, private markets, IPOs & exchanges' },
  { id: 'assets',    label: 'Asset Classes',      subtitle: 'Liquid & illiquid, public & private' },
  { id: 'risk',      label: 'Risk & Valuation',   subtitle: 'Risk-free rate, spreads, duration, beta' },
]

export const TOPICS = {
  // ── Macro & Geography ────────────────────────────────────────────────────
  'global-economy': {
    id: 'global-economy', layer: 'macro', title: 'The Global Economy',
    oneLiner: 'Growth, inflation, and trade set the backdrop every other market decision sits inside.',
    summary: "The global economy is the sum of what every country produces, consumes, borrows, and trades. Two numbers drive almost everything else in this module: GDP growth (is the pie growing?) and inflation (what's happening to the value of money?). Central banks react to both by setting interest rates, which ripple into currencies, bond yields, and ultimately what any asset is worth today versus tomorrow.",
    keyPoints: [
      'GDP growth and inflation are the two headline numbers that set the tone for every other market.',
      'Economies are interconnected through trade, capital flows, and currency exchange rates.',
      'A slowdown in one major economy (e.g. China or the US) transmits to others through trade and financial linkages.',
    ],
    parentId: null, childIds: ['regions'], relatedIds: ['central-banks'],
  },
  'regions': {
    id: 'regions', layer: 'macro', title: 'Regions & Trade Blocs',
    oneLiner: 'Countries cluster into blocs that trade and move together.',
    summary: "Below the global level, economies group into regions and trade blocs — North America, the Eurozone, Asia-Pacific, Emerging Markets — that share trade agreements, supply chains, and often move together in market cycles. Investors use regional classification to diversify: a single-country portfolio is exposed to one government's policy and one currency, while a global portfolio spreads that risk.",
    keyPoints: [
      'Trade blocs (EU, USMCA, ASEAN) create shared economic cycles among member countries.',
      "'Developed markets' vs 'emerging markets' is the most common regional risk split in investing.",
      'Regional ETFs let investors take a view on a bloc without picking individual countries.',
    ],
    parentId: 'global-economy', childIds: ['countries'], relatedIds: [],
  },
  'countries': {
    id: 'countries', layer: 'macro', title: 'Countries & Sovereign Risk',
    oneLiner: 'Each country carries its own government, currency, and credit risk.',
    summary: "Zooming in further, each country has its own government policy, central bank, fiscal budget, and credit rating. 'Sovereign risk' is the chance a government can't or won't honor its debts — priced directly into that country's bond yields. A country's own government bond yield (like the US 10-Year Treasury) becomes the reference 'risk-free rate' for everything priced in that currency.",
    keyPoints: [
      "Sovereign credit ratings (AAA, BBB, etc.) reflect a government's ability to repay its debt.",
      "A country's own government bond yield is the risk-free benchmark for assets in that currency.",
      'Political stability, fiscal deficits, and current account balances all feed into sovereign risk.',
    ],
    parentId: 'regions', childIds: ['currencies'], relatedIds: ['risk-free-rate'],
  },
  'currencies': {
    id: 'currencies', layer: 'macro', title: 'Currencies & FX',
    oneLiner: "The exchange rate between two countries' money — the base layer every cross-border investment sits on.",
    summary: "A currency is a country's unit of account, and its exchange rate against other currencies (FX) determines what a foreign asset is really worth once converted home. The US Dollar Index (DXY) tracks the dollar against a basket of major currencies and is a widely watched macro gauge — a strong dollar makes US goods pricier abroad and can pressure commodity prices and emerging-market debt denominated in dollars.",
    keyPoints: [
      'Exchange rates float based on relative interest rates, growth, and trade balances between two countries.',
      'A rising DXY (strong dollar) often pressures commodities and emerging markets with dollar-denominated debt.',
      'Currency risk is a hidden cost/benefit in any international investment — gains can be wiped out (or amplified) by FX moves.',
    ],
    parentId: 'countries', childIds: [], relatedIds: ['central-banks', 'currencies-fx'],
    linkTab: 'rates', linkLabel: 'See DXY on the Yield Curve & Rates tab',
  },
  'central-banks': {
    id: 'central-banks', layer: 'macro', title: 'Central Banks & Interest Rate Policy',
    oneLiner: 'The Fed (and its global peers) set the short-term rate that everything else is priced against.',
    summary: "Central banks like the US Federal Reserve set a short-term policy interest rate to manage inflation and employment. That single rate ripples outward: it anchors the short end of the yield curve, shapes currency strength, and changes the discount rate used to value every future cash flow — which is why 'what will the Fed do next' moves nearly every asset class.",
    keyPoints: [
      'The Fed Funds Rate is the base short-term rate the Federal Reserve controls directly.',
      'Raising rates fights inflation but slows growth and borrowing; cutting rates does the reverse.',
      'Markets often move more on the expected path of rates than on the current rate itself.',
    ],
    parentId: 'global-economy', childIds: [], relatedIds: ['currencies', 'risk-free-rate'],
    linkTab: 'fedwatch', linkLabel: 'Open Fed Watch',
  },

  // ── Market Structure ──────────────────────────────────────────────────────
  'public-vs-private': {
    id: 'public-vs-private', layer: 'structure', title: 'Public vs. Private Markets',
    oneLiner: "Every asset starts life 'private,' and some later become 'public' — the split that organizes this layer.",
    summary: 'Private markets involve a small number of investors negotiating directly with a company — no public price, limited liquidity, high minimums. Public markets involve a security listed on an exchange, priced continuously by anyone who wants to trade it. Almost every company, bond, or fund starts private, and some later go public to access a much larger pool of capital and liquidity.',
    keyPoints: [
      'Private = negotiated, illiquid, few investors, no continuous market price.',
      'Public = exchange-listed, liquid, continuous pricing, broad investor access.',
      "The transition from private to public is one of the most important events in a company's life.",
    ],
    parentId: null, childIds: ['issuer-concept'], relatedIds: ['mergers-acquisitions'],
  },
  'issuer-concept': {
    id: 'issuer-concept', layer: 'structure', title: 'The Issuer Concept',
    oneLiner: 'Every tradable security has an issuer — the entity that created it and owes something back to holders.',
    summary: "An 'issuer' is whoever creates and sells a security — a company issuing stock or bonds, a government issuing Treasuries, or a fund issuing shares. What the issuer owes back defines the security: equity gives an ownership stake with no promise of repayment; debt gives a fixed promise to repay principal plus interest. Every asset in the Asset Classes layer is ultimately just a claim on some issuer, priced differently depending on the kind of claim.",
    keyPoints: [
      'Equity issuers sell ownership; debt issuers sell a repayment promise (with interest).',
      "An issuer's creditworthiness (or growth prospects) directly drives what its securities are worth.",
      "Governments, corporations, and funds are all 'issuers' — just of different kinds of claims.",
    ],
    parentId: 'public-vs-private', childIds: ['private-markets'], relatedIds: [],
  },
  'private-markets': {
    id: 'private-markets', layer: 'structure', title: 'Private Markets: Placement, VC & PE',
    oneLiner: 'Before a company is public, it raises money by selling stakes directly to a handful of investors.',
    summary: "A private placement is a direct sale of securities to a limited group of investors (venture capital, private equity, or accredited individuals) instead of the general public. Venture capital funds early-stage, high-risk companies for equity; private equity typically buys larger, established companies outright (often using debt) to restructure and later resell. Because there's no public market, private stakes are illiquid — investors may wait years for an exit via IPO, acquisition, or secondary sale.",
    keyPoints: [
      'Private placements skip public disclosure requirements in exchange for restricting who can buy in.',
      'Venture capital = early-stage, high-risk, equity-only; private equity = later-stage, often uses debt (leveraged buyouts).',
      'The main exit paths from a private stake are an IPO, an acquisition, or a secondary sale to another private investor.',
    ],
    parentId: 'issuer-concept', childIds: ['going-public'], relatedIds: ['private-equity-vc'],
  },
  'going-public': {
    id: 'going-public', layer: 'structure', title: 'Going Public: IPOs, Direct Listings & SPACs',
    oneLiner: "The moment a private company's shares become tradable by anyone, on an exchange.",
    summary: 'An Initial Public Offering (IPO) is when a company sells new shares to public investors for the first time, usually underwritten by investment banks who help set the price and manage the sale. A direct listing skips the new-share sale and simply lists existing shares for trading. A SPAC is a shortcut: an already-public shell company merges with a private target, effectively taking it public without a traditional IPO process.',
    keyPoints: [
      'IPO = new shares sold with bank underwriting; direct listing = existing shares start trading, no new capital raised.',
      'A SPAC merger takes a private company public by combining it with an already-listed shell company.',
      "Early IPO shares are often subject to a 'lockup period' preventing insiders from selling for a set time after listing.",
    ],
    parentId: 'private-markets', childIds: ['secondary-markets'], relatedIds: ['spacs-concept'],
    linkTab: 'ipocalendar', linkLabel: 'Open IPO & Lockup Calendar',
  },
  'spacs-concept': {
    id: 'spacs-concept', layer: 'structure', title: 'SPACs: A Shortcut to Public Markets',
    oneLiner: "A publicly-listed 'blank check' shell company whose only job is to merge with a private business.",
    summary: 'A SPAC IPOs first with no operating business — just cash held in trust — then has a limited window (often 18-24 months) to find and merge with a private company, which becomes public as a result of that merger. Investors in the SPAC before the merger can typically redeem their shares for the trust value if they dislike the deal, giving some downside protection while retaining upside if the merger succeeds.',
    keyPoints: [
      "A SPAC's IPO raises cash into trust before any target company is chosen.",
      'Pre-merger SPAC shareholders can usually redeem shares for the trust value, capping downside.',
      'If no merger closes in time, the SPAC liquidates and returns trust cash to investors.',
    ],
    parentId: 'going-public', childIds: [], relatedIds: [],
    linkTab: 'spacoverview', linkLabel: 'Open SPACs',
  },
  'secondary-markets': {
    id: 'secondary-markets', layer: 'structure', title: 'Secondary Markets & Exchange Trading',
    oneLiner: 'After the IPO, nearly all trading is investors buying from other investors — not from the company.',
    summary: "Once listed, a stock trades on a secondary market — an exchange like the NYSE or Nasdaq — where investors buy and sell among themselves; the issuing company doesn't receive money from these trades (except in follow-on offerings). Exchanges match buyers and sellers continuously via an order book, and the resulting price is what most people mean by 'the stock price.' This is also where price discovery happens: news, earnings, and sentiment get reflected almost instantly.",
    keyPoints: [
      "'Secondary market' trading is investor-to-investor; the company already received its capital at the IPO.",
      'Exchanges (NYSE, Nasdaq) run continuous order-matching that sets the real-time market price.',
      'Liquidity — how easily you can buy/sell without moving the price — is usually far higher on public exchanges than in private markets.',
    ],
    parentId: 'going-public', childIds: [], relatedIds: ['mergers-acquisitions'],
    linkTab: 'market', linkLabel: 'Open Markets Overview',
  },
  'mergers-acquisitions': {
    id: 'mergers-acquisitions', layer: 'structure', title: 'M&A: Going Private & Deal Arbitrage',
    oneLiner: 'Public companies can also be taken private again — through an acquisition or buyout.',
    summary: "The public/private line runs both ways: a public company can be acquired by another company (in cash, stock, or a mix) or bought out and taken private, ending its exchange listing. 'Merger arbitrage' is a strategy that trades the spread between a target's current price and its announced deal price, betting on whether and when the deal closes.",
    keyPoints: [
      'An acquisition can be all-cash, all-stock, or a mix — this changes how the deal is valued and taxed.',
      "Deals need regulatory approval, which is why a 'deal spread' exists between market price and offer price.",
      'Merger arbitrage profits from that spread closing when (and if) the deal completes.',
    ],
    parentId: 'public-vs-private', childIds: [], relatedIds: ['secondary-markets'],
    linkTab: 'mergeroverview', linkLabel: 'Open Merger Arb',
  },

  // ── Asset Classes ─────────────────────────────────────────────────────────
  'asset-classes-overview': {
    id: 'asset-classes-overview', layer: 'assets', title: 'Asset Classes: Liquid vs. Illiquid',
    oneLiner: 'Everything you can invest in falls into a class — and how easily you can exit it matters as much as what it is.',
    summary: 'An asset class groups investments that behave similarly and are valued using similar tools: equities, fixed income, currencies, commodities, real estate, and private equity/venture capital are the main ones. Just as important as the type is liquidity — how quickly and cheaply you can convert the asset back to cash without moving its price. Public stocks and Treasuries are highly liquid; real estate and private equity stakes can take months or years to sell.',
    keyPoints: [
      'Every asset class is ultimately a claim on an issuer (see Market Structure) — the class just describes the shape of that claim.',
      'Liquidity is a spectrum, not a binary: public equities > corporate bonds > real estate > private equity/VC.',
      'Diversifying across asset classes reduces reliance on any single economic driver.',
    ],
    parentId: null,
    childIds: ['equities', 'fixed-income', 'currencies-fx', 'commodities', 'real-estate', 'private-equity-vc', 'crypto-assets'],
    relatedIds: [],
  },
  'equities': {
    id: 'equities', layer: 'assets', title: 'Equities (Stocks)',
    oneLiner: 'An ownership slice of a company — no promised return, but unlimited upside and a claim on future profits.',
    summary: "A share of stock is a fractional ownership stake in a company: shareholders benefit from profit growth (via price appreciation and dividends) and have a residual claim on assets if the company is wound down — after all debt holders are paid. Because there's no fixed repayment, equity is the highest-risk, highest-potential-return layer of a company's capital structure.",
    keyPoints: [
      'Equity holders are paid last in a liquidation — but have unlimited upside while the business grows.',
      'Valuation tools include P/E, P/B, and discounted cash flow (DCF) — how much future profit is worth today.',
      'Dividends and buybacks are the two ways companies return profit directly to shareholders.',
    ],
    parentId: 'asset-classes-overview', childIds: [], relatedIds: ['going-public'],
    linkTab: 'fundamentals', linkLabel: 'Open Fundamentals',
  },
  'fixed-income': {
    id: 'fixed-income', layer: 'assets', title: 'Fixed Income (Bonds)',
    oneLiner: 'A loan to an issuer that promises to pay back a fixed amount, plus interest, on a schedule.',
    summary: 'A bond is a loan: the buyer lends money to an issuer (a government or a company) in exchange for regular interest payments (the coupon) and return of principal at maturity. Bonds are generally lower-risk than equity in the same issuer because they get repaid first, but they trade daily and their price moves inversely to interest rates — when rates rise, existing lower-coupon bonds become less attractive and fall in price.',
    keyPoints: [
      'Bond price and interest rates move inversely — this relationship is called duration risk.',
      'Bondholders are repaid before equity holders if an issuer runs into trouble.',
      "The bond's yield combines the coupon and the price paid — not just the stated coupon rate.",
    ],
    parentId: 'asset-classes-overview', childIds: ['treasuries', 'corporate-bonds', 'convertible-bonds'], relatedIds: [],
  },
  'treasuries': {
    id: 'treasuries', layer: 'assets', title: 'Government / Treasury Bonds',
    oneLiner: "Debt issued by a government — the closest thing markets have to a 'risk-free' asset.",
    summary: "US Treasuries are debt issued by the federal government, considered the benchmark risk-free asset because the government can print its own currency to repay in nominal terms. Every other bond, and indirectly every other asset, is priced with reference to Treasury yields — they set the 'floor' cost of money that every riskier investment must beat to be worth holding.",
    keyPoints: [
      'Treasury yields across maturities (13-week to 30-year) form the yield curve — a key economic signal.',
      'An inverted yield curve (short rates above long rates) has historically preceded recessions.',
      'Treasury yields are the reference risk-free rate used to value nearly everything else.',
    ],
    parentId: 'fixed-income', childIds: [], relatedIds: ['risk-free-rate'],
    linkTab: 'treasurybonds', linkLabel: 'Open Treasury Bonds',
  },
  'corporate-bonds': {
    id: 'corporate-bonds', layer: 'assets', title: 'Corporate Bonds',
    oneLiner: "A company's debt — paying a higher yield than Treasuries to compensate for credit risk.",
    summary: "Corporate bonds are issued by companies rather than governments, and because companies can default, they trade at a yield premium over Treasuries of the same maturity — the credit spread. That spread widens when the market worries about a company's (or the economy's) health, and narrows when confidence improves, making it a real-time gauge of perceived credit risk.",
    keyPoints: [
      'Credit ratings (AAA down to junk/high-yield) summarize an issuer\'s default risk and directly set the spread.',
      "'Investment grade' vs 'high yield (junk)' is the main quality split in corporate bonds.",
      "The credit spread over Treasuries is the market's live read on how risky a company looks right now.",
    ],
    parentId: 'fixed-income', childIds: [], relatedIds: ['credit-spread'],
    linkTab: 'corporatebonds', linkLabel: 'Open Corporate Bonds',
  },
  'convertible-bonds': {
    id: 'convertible-bonds', layer: 'assets', title: 'Convertible Bonds',
    oneLiner: "A bond with a built-in option to convert into the issuer's stock — a hybrid of debt and equity.",
    summary: 'A convertible bond pays interest like a regular bond but gives the holder the right to convert it into a set number of shares later. This hybrid structure lets a company borrow at a lower interest rate (investors accept less yield for the upside optionality) while giving bondholders equity-like gains if the stock rises well above the conversion price.',
    keyPoints: [
      "Convertibles trade with 'bond floor' downside protection and equity-like upside if the stock rallies.",
      'Companies use them to raise debt more cheaply than a straight bond would allow.',
      'The conversion price is the stock price at which converting becomes more valuable than holding the bond.',
    ],
    parentId: 'fixed-income', childIds: [], relatedIds: [],
    linkTab: 'convertiblebonds', linkLabel: 'Open Convertible Bonds',
  },
  'currencies-fx': {
    id: 'currencies-fx', layer: 'assets', title: 'Currencies as an Asset Class',
    oneLiner: "Trading one country's money against another's — the world's most liquid, 24-hour market.",
    summary: "Beyond being a unit of account (see Macro & Geography), currencies are also directly tradable through the foreign exchange (FX) market — the largest and most liquid market in the world, trading nearly 24 hours a day. FX traders take positions on relative interest rates, growth, and risk sentiment between two currencies at a time (a 'pair'), often using significant leverage.",
    keyPoints: [
      "FX is quoted in pairs (e.g. EUR/USD) — you're always long one currency and short the other.",
      'Interest rate differentials between two countries are a primary driver of currency pair direction (the carry trade).',
      'FX is typically the most liquid and highest-leverage market retail traders can access.',
    ],
    parentId: 'asset-classes-overview', childIds: [], relatedIds: ['currencies'],
  },
  'commodities': {
    id: 'commodities', layer: 'assets', title: 'Commodities',
    oneLiner: 'Physical, interchangeable goods — energy, metals, and agriculture — traded mostly via futures.',
    summary: 'Commodities are raw physical goods — oil, gold, copper, wheat — that are largely interchangeable regardless of who produced them. Because storing and delivering the physical good is impractical for most investors, commodities are usually traded via futures contracts (a promise to buy/sell at a set price on a future date) or through ETFs that hold futures or physical stockpiles.',
    keyPoints: [
      'Commodities are priced by real-world supply and demand — weather, geopolitics, and production directly move prices.',
      'Most commodity exposure is via futures contracts, not physical delivery.',
      'Gold is often held as a hedge against inflation and currency debasement rather than for industrial use.',
    ],
    parentId: 'asset-classes-overview', childIds: [], relatedIds: [],
  },
  'real-estate': {
    id: 'real-estate', layer: 'assets', title: 'Real Estate',
    oneLiner: 'Physical property — one of the largest asset classes globally, and one of the least liquid.',
    summary: 'Real estate can be owned directly (a physical property, generating rent and potential appreciation) or indirectly through a REIT (Real Estate Investment Trust), a company that owns income-producing property and trades like a stock on an exchange. Direct ownership is illiquid and capital-intensive; REITs trade publicly and offer much faster entry/exit, at the cost of the price volatility direct owners don\'t experience day to day.',
    keyPoints: [
      'Direct property is illiquid and requires significant capital, financing, and management.',
      'REITs securitize real estate into a publicly-traded, liquid instrument.',
      'Real estate returns come from both income (rent/dividends) and price appreciation.',
    ],
    parentId: 'asset-classes-overview', childIds: [], relatedIds: [],
  },
  'private-equity-vc': {
    id: 'private-equity-vc', layer: 'assets', title: 'Private Equity & Venture Capital',
    oneLiner: "Professionally-managed pools of capital that buy stakes in companies before (or instead of) they're ever public.",
    summary: 'Private equity and venture capital funds raise money from institutions and wealthy investors, then deploy it into private companies — VC into early, high-growth startups for equity; PE typically into mature businesses, often using leverage to fund buyouts. Returns are realized only when a portfolio company exits — via IPO, sale, or recapitalization — which can take years, making this one of the least liquid mainstream asset classes.',
    keyPoints: [
      "Capital is typically locked up for years (a fund's lifecycle) before investors see it back.",
      'VC targets high failure rates offset by a few outsized winners; PE targets steadier operational improvement.',
      "Illiquidity is compensated for with an 'illiquidity premium' — a higher expected return than public markets.",
    ],
    parentId: 'asset-classes-overview', childIds: [], relatedIds: ['private-markets', 'liquidity-risk'],
  },
  'crypto-assets': {
    id: 'crypto-assets', layer: 'assets', title: 'Digital Assets & Crypto',
    oneLiner: 'Blockchain-native assets that trade 24/7 with no central issuer behind most of them.',
    summary: "Cryptocurrencies and other digital assets are recorded on a blockchain rather than issued by a company or government, and most trade continuously, every day of the year, on both centralized and decentralized exchanges. Because there's often no cash flow or issuer balance sheet to anchor a valuation, prices are driven heavily by supply mechanics, adoption, and sentiment — making this one of the more volatile corners of the asset-class spectrum.",
    keyPoints: [
      'Most cryptocurrencies have no issuer or cash flow — valuation frameworks differ fundamentally from stocks/bonds.',
      'Trading is continuous (24/7/365), unlike traditional exchanges with fixed hours.',
      'Custody (who actually holds the asset) is a distinct risk that does not exist in the same way for traditional securities.',
    ],
    parentId: 'asset-classes-overview', childIds: [], relatedIds: [],
    linkTab: 'crypto', linkLabel: 'Open Crypto',
  },

  // ── Risk & Valuation ──────────────────────────────────────────────────────
  'risk-free-rate': {
    id: 'risk-free-rate', layer: 'risk', title: 'The Risk-Free Rate',
    oneLiner: "The starting point for valuing anything: what you'd earn with essentially no risk at all.",
    summary: "The risk-free rate — usually the yield on a short-term government bond like US Treasuries — is the return available with, in practice, no default risk. Every other investment is priced as 'risk-free rate plus a premium' for the extra risk being taken on, whether that's credit risk, equity risk, or illiquidity. When the risk-free rate rises, the bar for every other investment to be worthwhile rises with it — which is why interest rate moves affect the value of nearly every asset class.",
    keyPoints: [
      'Every discounted cash flow (DCF) valuation starts with the risk-free rate as its baseline discount rate.',
      'A higher risk-free rate makes future cash flows worth less today, pressuring growth-stock and long-bond valuations most.',
      'The risk-free rate is the reference point every credit spread and risk premium is measured against.',
    ],
    parentId: null, childIds: ['credit-spread'], relatedIds: ['treasuries', 'central-banks'],
    linkTab: 'rates', linkLabel: 'Open Yield Curve & Rates',
  },
  'credit-spread': {
    id: 'credit-spread', layer: 'risk', title: 'Credit Spread',
    oneLiner: 'The extra yield a riskier borrower must pay above the risk-free rate to get anyone to lend to them.',
    summary: "The credit spread is the difference between a bond's yield and the risk-free Treasury yield of the same maturity — it's the market's price for that issuer's default risk. Spreads widen in times of stress (investors demand more compensation for risk) and narrow when confidence is high, making credit spreads a real-time barometer of financial market health, not just one company's outlook.",
    keyPoints: [
      "Credit spread = issuer's bond yield − Treasury yield at the same maturity.",
      "Widening spreads across the market signal rising systemic risk, not just one company's trouble.",
      'A lower credit rating generally means a wider spread and a higher cost of borrowing for that issuer.',
    ],
    parentId: 'risk-free-rate', childIds: ['duration-risk'], relatedIds: ['corporate-bonds'],
    linkTab: 'corporatebonds', linkLabel: 'See Credit Spread vs. Treasury Curve',
  },
  'duration-risk': {
    id: 'duration-risk', layer: 'risk', title: 'Duration & Interest Rate Risk',
    oneLiner: "How much a bond's price moves when interest rates change — longer maturities move more.",
    summary: "Duration measures a bond's price sensitivity to interest rate changes — roughly, the percentage price change for a 1% move in rates. A bond with 10 years of duration loses about 10% of its value if rates rise 1%, all else equal, while a 2-year-duration bond barely moves. Longer-maturity and lower-coupon bonds have higher duration, which is why long-dated Treasuries can be surprisingly volatile despite having virtually no default risk.",
    keyPoints: [
      'Higher duration means more price sensitivity to interest rate changes, in either direction.',
      'Duration risk exists even in risk-free Treasuries — it is a rate bet, not a credit bet.',
      'Shortening duration (buying shorter-maturity bonds) is the standard way to reduce interest-rate risk.',
    ],
    parentId: 'credit-spread', childIds: ['volatility-beta'], relatedIds: [],
  },
  'volatility-beta': {
    id: 'volatility-beta', layer: 'risk', title: 'Volatility & Beta',
    oneLiner: "How much an asset's price swings, and how much of that swing tracks the overall market.",
    summary: "Volatility measures how much a price moves over time regardless of direction; beta measures how much of that movement is explained by the broader market's movement (a beta of 1.5 means the stock tends to move 1.5x whatever the market does). Together they're the core inputs for measuring portfolio risk — a well-known portfolio-level tool is the Sharpe ratio, which measures return earned per unit of volatility taken.",
    keyPoints: [
      'Beta above 1 means more volatile than the market; beta below 1 means less volatile (or uncorrelated).',
      'Sharpe ratio = (return − risk-free rate) ÷ volatility — a way to compare risk-adjusted returns across assets.',
      'Diversifying across low-correlation assets lowers portfolio volatility without necessarily lowering expected return.',
    ],
    parentId: 'duration-risk', childIds: ['liquidity-risk'], relatedIds: [],
    linkTab: 'portfolio', linkLabel: 'Open Portfolio → Risk view',
  },
  'liquidity-risk': {
    id: 'liquidity-risk', layer: 'risk', title: 'Liquidity Risk',
    oneLiner: "The risk that you can't exit a position quickly without moving the price against yourself.",
    summary: "Liquidity risk is the danger that when you actually need to sell, there aren't enough willing buyers at a fair price — forcing a discount to exit, or a long wait. It's the thread connecting the whole onion: public equities and Treasuries sit at the liquid end, private equity and direct real estate at the illiquid end, and investors are generally compensated with an 'illiquidity premium' for accepting that risk.",
    keyPoints: [
      'Liquidity risk shows up as a wider bid-ask spread and higher price impact from trading.',
      'It tends to spike during market stress, exactly when investors most want to sell.',
      'The illiquidity premium is the extra expected return investors demand for locking up capital (see Private Equity & VC).',
    ],
    parentId: 'volatility-beta', childIds: [], relatedIds: ['private-equity-vc'],
  },
}
