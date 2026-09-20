// Investor Education content — a graph of concepts organized into five
// "onion" layers (Macro → Market Structure → Asset Classes → Risk &
// Valuation → Valuation & Analysis). Each topic has a parent/children (top-down / bottom-up
// drill path) plus lateral `relatedIds` that cross layers, and an optional
// `linkTab` that deep-links to the live tool built for that concept
// elsewhere in the app. A handful of topics also carry `liveStat`: an
// endpoint plus a `parse(json)` function returning {label, value, sub} to
// ground the concept in a real, current number — return null from parse to
// hide the block instead of showing an empty stat. Pure data — no rendering
// logic here beyond these small parse functions.

export const LAYERS = [
  { id: 'macro',     label: 'Macro & Geography', subtitle: 'Economy → regions → countries → currencies' },
  { id: 'structure', label: 'Market Structure',   subtitle: 'Issuers, private markets, IPOs & exchanges' },
  { id: 'assets',    label: 'Asset Classes',      subtitle: 'Liquid & illiquid, public & private' },
  { id: 'risk',      label: 'Risk & Valuation',   subtitle: 'Risk-free rate, spreads, duration, beta' },
  { id: 'analysis',  label: 'Valuation & Analysis', subtitle: 'Financial statements, quality, multiples, DCF, earnings' },
]

// Live-stat formatters: fractions → "12.3%", ratios → "12.3×", and null-safe
// so a missing field hides the stat block instead of rendering "NaN".
const pct = (v) => (v == null ? null : `${(v * 100).toFixed(1)}%`)
const mult = (v) => (v == null ? null : `${v.toFixed(1)}×`)

// The Valuation & Analysis live stats all use one well-known large-cap as a
// worked example, so the numbers stay stable and comparable across topics.
const EXAMPLE_SYMBOL = 'AAPL'
const fundamentalsRow = (d) => (d.rows || []).find(r => r.symbol === EXAMPLE_SYMBOL) || null
const FUNDAMENTALS_ENDPOINT = `/api/compare/fundamentals?symbols=${EXAMPLE_SYMBOL}`

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
    parentId: null, childIds: ['regions', 'central-banks'], relatedIds: [],
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
    liveStat: {
      endpoint: '/api/market/rates',
      parse: (d) => (d.dxy == null ? null : {
        label: 'US Dollar Index (DXY)',
        value: d.dxy.toFixed(2),
        sub: 'Tracks the dollar against a basket of major currencies',
      }),
    },
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
    liveStat: {
      endpoint: '/api/market/fed-watch',
      parse: (d) => {
        const next = (d.meetings || []).find(m => m.status === 'upcoming')
        return {
          label: 'Current Fed Funds Target',
          value: d.currentTarget || '—',
          sub: next
            ? `Next FOMC meeting ${next.date}: ${next.cutProb ?? '—'}% cut / ${next.holdProb ?? '—'}% hold / ${next.hikeProb ?? '—'}% hike priced in`
            : undefined,
        }
      },
    },
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
    parentId: null, childIds: ['issuer-concept', 'mergers-acquisitions'], relatedIds: [],
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
    parentId: 'public-vs-private', childIds: ['private-markets', 'capital-structure'], relatedIds: ['derivatives'],
  },
  'capital-structure': {
    id: 'capital-structure', layer: 'structure', title: 'The Capital Structure: Ranking Claims on an Issuer',
    oneLiner: 'Every security an issuer creates is a claim on it — capital structure is the order those claims get paid in.',
    summary: "A single company can have many different securities outstanding at once — a secured loan, senior bonds, subordinated bonds, preferred stock, common stock — and each is really just a different-ranked claim on the same underlying business. Capital structure is the hierarchy those claims are paid in during a bankruptcy or liquidation: secured debt first (backed by specific collateral), then senior unsecured debt, then subordinated ('junior') debt, then preferred stock, and common equity holders last. That ranking is exactly why one issuer's bonds are safer — and lower-yielding — than its own stock, and why its 'junior' debt yields more than its 'senior' debt.",
    keyPoints: [
      'Seniority determines who gets paid first if an issuer defaults or liquidates: secured debt → senior unsecured debt → subordinated debt → preferred stock → common equity.',
      "The same issuer's securities can carry very different risk and yield purely because of where they sit in this stack — not because the underlying business changed.",
      "Preferred stock is a hybrid: it ranks above common equity but below all debt, usually pays a fixed dividend, and typically doesn't vote.",
      'A convertible bond sits with the debt until conversion, but carries an embedded option to convert into common equity — a hybrid that reaches across the stack (see Derivatives).',
    ],
    parentId: 'issuer-concept', childIds: [], relatedIds: ['corporate-bonds', 'convertible-bonds', 'equities', 'derivatives'],
    diagram: 'capital-structure-tree',
  },
  'derivatives': {
    id: 'derivatives', layer: 'assets', title: "Derivatives: Contracts Built on an Issuer's Securities",
    oneLiner: "A contract whose value comes from another security or event — a side bet the issuer isn't even a party to.",
    summary: "A derivative doesn't represent a direct claim on an issuer the way a bond or share does — it's a contract between two other parties whose payoff derives from the price of an underlying security, index, or event. Options and futures reference a stock, bond, or index price; a Credit Default Swap (CDS) references a specific issuer's default risk directly, acting like insurance against that issuer failing to pay its debt. Because no capital changes hands with the issuer, trading derivatives doesn't fund the company at all — it just lets other investors transfer or take on risk tied to that issuer's fortunes, often with far more leverage than owning the underlying security would allow.",
    keyPoints: [
      "A derivative 'derives' its value from an underlying security or event — it's a side contract between two other investors, not a new claim registered against the issuer.",
      'Options (calls/puts), futures/forwards, swaps, and Credit Default Swaps (CDS) are the main derivative types — CDS references an issuer\'s default risk most directly.',
      "A convertible bond's conversion right is itself an embedded derivative (a call option on the issuer's stock) bundled inside an otherwise ordinary bond.",
      "Derivatives let investors take much larger, more leveraged positions on an issuer's fortunes than buying the underlying security outright.",
    ],
    parentId: 'asset-classes-overview', childIds: [], relatedIds: ['issuer-concept', 'capital-structure', 'equities', 'corporate-bonds'],
    linkTab: 'optionstracker', linkLabel: 'Open Options P&L Tracker',
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
    parentId: 'private-markets', childIds: ['secondary-markets', 'spacs-concept'], relatedIds: [],
    linkTab: 'ipocalendar', linkLabel: 'Open IPO & Lockup Calendar',
    liveStat: {
      endpoint: '/api/market/ipo-calendar',
      parse: (d) => (!Array.isArray(d) ? null : {
        label: 'Recently Priced IPOs Tracked',
        value: String(d.length),
        sub: 'From SEC 424B4 filings, with live lockup-expiration countdowns',
      }),
    },
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
    childIds: ['equities', 'fixed-income', 'currencies-fx', 'commodities', 'real-estate', 'private-equity-vc', 'crypto-assets', 'derivatives'],
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
    parentId: 'asset-classes-overview', childIds: [], relatedIds: ['going-public', 'capital-structure', 'derivatives', 'valuation-multiples'],
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
    liveStat: {
      endpoint: '/api/market/rates',
      parse: (d) => (d.yields?.t10y == null ? null : {
        label: '10-Year Treasury Yield',
        value: `${d.yields.t10y.toFixed(2)}%`,
        sub: d.inverted
          ? 'Yield curve currently INVERTED (10Y below 13-week)'
          : d.spread_10y_13w != null ? `10Y − 13-week spread: ${d.spread_10y_13w.toFixed(2)} pts` : undefined,
      }),
    },
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
    parentId: 'fixed-income', childIds: [], relatedIds: ['credit-spread', 'capital-structure', 'derivatives'],
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
      'The conversion right is itself an embedded derivative — a call option on the issuer\'s stock bundled into an otherwise ordinary bond.',
    ],
    parentId: 'fixed-income', childIds: [], relatedIds: ['capital-structure', 'derivatives'],
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
    liveStat: {
      endpoint: '/api/market/crypto',
      parse: (d) => {
        const btc = (d.coins || []).find(c => c.symbol === 'BTC-USD')
        if (!btc || btc.price == null) return null
        return {
          label: 'Bitcoin (BTC)',
          value: `$${btc.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
          sub: btc.change24h != null ? `${btc.change24h >= 0 ? '+' : ''}${btc.change24h}% (24h)` : undefined,
        }
      },
    },
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
    parentId: null, childIds: ['credit-spread'], relatedIds: ['treasuries', 'central-banks', 'dcf-intrinsic-value'],
    linkTab: 'rates', linkLabel: 'Open Yield Curve & Rates',
    liveStat: {
      endpoint: '/api/market/rates',
      parse: (d) => (d.yields?.t10y == null ? null : {
        label: 'Current Risk-Free Rate (10Y Treasury)',
        value: `${d.yields.t10y.toFixed(2)}%`,
        sub: 'The baseline every DCF discount rate and credit spread builds on',
      }),
    },
  },
  'credit-spread': {
    id: 'credit-spread', layer: 'risk', title: 'Credit Spread',
    oneLiner: 'The extra yield a riskier borrower must pay above the risk-free rate to get anyone to lend to them.',
    summary: "The credit spread is the difference between a bond's yield and the risk-free Treasury yield of the same maturity — it's the market's price for that issuer's default risk. Spreads widen in times of stress (investors demand more compensation for risk) and narrow when confidence is high, making credit spreads a real-time barometer of financial market health, not just one company's outlook.",
    keyPoints: [
      "Credit spread = issuer's bond yield − Treasury yield at the same maturity.",
      "Widening spreads across the market signal rising systemic risk, not just one company's trouble.",
      'A lower credit rating generally means a wider spread and a higher cost of borrowing for that issuer.',
      "A Credit Default Swap (CDS) trades that same default risk directly, without owning the bond — its spread typically moves in step with the cash bond's credit spread.",
    ],
    parentId: 'risk-free-rate', childIds: ['duration-risk'], relatedIds: ['corporate-bonds', 'derivatives'],
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
    liveStat: {
      endpoint: '/api/home/summary',
      parse: (d) => {
        const vix = d.market?.vix
        if (!vix || vix.price == null) return null
        return {
          label: 'VIX (Volatility Index)',
          value: vix.price.toFixed(2),
          sub: vix.label ? `Regime: ${vix.label}` : undefined,
        }
      },
    },
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

  // ── Valuation & Analysis ──────────────────────────────────────────────────
  'financial-statements': {
    id: 'financial-statements', layer: 'analysis', title: 'Reading the Three Financial Statements',
    oneLiner: 'The income statement, balance sheet, and cash flow statement are three views of the same business.',
    summary: "Every public company reports three linked statements. The income statement shows performance over a period — revenue minus costs leaves net income. The balance sheet is a snapshot at one date — what the company owns (assets) equals what it owes (liabilities) plus what belongs to shareholders (equity). The cash flow statement tracks the actual cash that moved in and out, split into operating, investing, and financing. They connect: net income flows into equity on the balance sheet and is the starting point of the cash flow statement. Reading them together is how you tell a business that merely reports profit from one that actually produces cash.",
    keyPoints: [
      'Income statement: revenue → gross profit → operating income → net income. The margin at each step shows where the money goes.',
      "Balance sheet: assets = liabilities + shareholders' equity. It shows leverage (debt vs. equity) and liquidity (cash vs. near-term obligations) — the same claims ranked in the Capital Structure topic.",
      'Cash flow statement: free cash flow = operating cash flow − capital expenditures. It is the cash left over for owners and lenders.',
      'Profit is not cash. Accruals and depreciation shape net income, while cash is much harder to dress up — a persistent gap between the two is a red flag.',
      'Public companies file audited annual (10-K) and quarterly (10-Q) statements with the SEC, freely searchable on EDGAR.',
    ],
    parentId: null, childIds: ['profitability-quality'], relatedIds: ['capital-structure', 'issuer-concept', 'equities'],
    linkTab: 'fundamentals', linkLabel: 'Open Fundamentals',
    liveStat: {
      endpoint: FUNDAMENTALS_ENDPOINT,
      parse: (d) => {
        const r = fundamentalsRow(d)
        const gross = pct(r?.['Gross Margin']), op = pct(r?.['Op Margin']), net = pct(r?.['Net Margin'])
        if (!gross || !op || !net) return null
        return {
          label: `${EXAMPLE_SYMBOL}: margin at each step of the income statement`,
          value: `${gross} → ${op} → ${net}`,
          sub: 'Gross → operating → net margin: how much of each revenue dollar survives each layer of cost',
        }
      },
    },
  },
  'profitability-quality': {
    id: 'profitability-quality', layer: 'analysis', title: 'Profitability, Quality & Moats',
    oneLiner: 'How much a business earns on the capital it uses — and whether it can keep doing so.',
    summary: "Growth is only valuable if it earns more than it costs. Return on equity (ROE = net income ÷ shareholders' equity) and return on invested capital (ROIC = operating profit after tax ÷ debt plus equity invested, net of cash) measure how efficiently a company turns capital into profit. ROIC is the cleaner test because it ignores how the business is financed: a company earning an ROIC above its cost of capital is creating value, and one earning below it is destroying value even while growing. Durable high returns usually need a moat — a lasting advantage such as brand, network effects, switching costs, cost leadership, or regulation and patents — that competitors can't easily copy.",
    keyPoints: [
      "ROIC above the company's cost of capital means growth creates value; below it, growth destroys value.",
      'ROE can be inflated by leverage and by buybacks that shrink equity — cross-check it against ROA, ROIC, and debt levels.',
      'Margins and returns that stay stable or rise over many years are the fingerprint of a moat; sharp mean-reversion suggests there is none.',
      'Common moat sources: brand, network effects, switching costs, cost advantages, and regulatory or IP protection.',
      "Quality tells you what a business is worth owning — not what price to pay. That's the job of the next two topics.",
    ],
    parentId: 'financial-statements', childIds: ['valuation-multiples'], relatedIds: ['capital-structure', 'equities'],
    linkTab: 'fundamentals', linkLabel: 'Compare margins and returns in Fundamentals',
    liveStat: {
      endpoint: FUNDAMENTALS_ENDPOINT,
      parse: (d) => {
        const r = fundamentalsRow(d)
        const roe = pct(r?.ROE), roa = pct(r?.ROA)
        if (!roe || !roa) return null
        return {
          label: `${EXAMPLE_SYMBOL}: return on equity vs. return on assets`,
          value: `ROE ${roe} · ROA ${roa}`,
          sub: 'A big gap between the two means leverage or buybacks are doing part of the work — check debt before crediting quality',
        }
      },
    },
  },
  'valuation-multiples': {
    id: 'valuation-multiples', layer: 'analysis', title: 'Valuation Ratios & Multiples',
    oneLiner: 'Price expressed relative to earnings, sales, or cash flow — a shorthand for what the market is paying.',
    summary: "A multiple divides a company's price by a fundamental, so you can compare very different-sized companies. P/E is price ÷ earnings per share (forward P/E uses expected earnings). EV/EBITDA divides enterprise value — market cap plus debt minus cash — by operating earnings before interest, taxes, depreciation, and amortization; because it includes debt, it compares companies with different capital structures fairly. P/S suits growing companies that aren't yet profitable, P/B suits banks and asset-heavy businesses, and free cash flow yield (FCF ÷ market cap) can be read like the yield on a bond. A multiple on its own means nothing: it only becomes information when set against the company's own history, its peers, its growth, and the interest-rate backdrop.",
    keyPoints: [
      "P/E = price ÷ EPS. A high P/E isn't automatically expensive — it can be justified by fast growth, and the PEG ratio (P/E ÷ growth) adjusts for that.",
      'EV/EBITDA includes debt, so it compares companies with different capital structures on equal footing (see The Capital Structure).',
      'Different businesses call for different multiples: P/S for early-stage growth, P/B for banks, EV/EBITDA for capital-heavy firms, FCF yield for mature cash generators.',
      "Always compare against peers and the company's own history. A 'cheap' multiple can be a value trap — cheap because earnings are about to fall.",
      'Higher interest rates pull multiples down, because the discount rate applied to future earnings rises with the risk-free rate.',
    ],
    parentId: 'profitability-quality', childIds: ['dcf-intrinsic-value'], relatedIds: ['equities', 'capital-structure', 'risk-free-rate'],
    linkTab: 'fundamentals', linkLabel: 'Compare multiples side by side',
    liveStat: {
      endpoint: FUNDAMENTALS_ENDPOINT,
      parse: (d) => {
        const r = fundamentalsRow(d)
        const pe = mult(r?.['P/E (Trailing)'])
        if (!pe) return null
        const fwd = mult(r?.['P/E (Forward)'])
        const ev = mult(r?.['EV/EBITDA'])
        const ps = mult(r?.['P/S'])
        return {
          label: `${EXAMPLE_SYMBOL}: trailing P/E`,
          value: pe,
          sub: [fwd && `Forward P/E ${fwd}`, ev && `EV/EBITDA ${ev}`, ps && `P/S ${ps}`].filter(Boolean).join(' · ') || undefined,
        }
      },
    },
  },
  'dcf-intrinsic-value': {
    id: 'dcf-intrinsic-value', layer: 'analysis', title: 'Intrinsic Value & Discounted Cash Flow',
    oneLiner: "What a business's future cash flows are worth today, after adjusting for time and risk.",
    summary: "Multiples tell you what the market pays for similar companies; a discounted cash flow (DCF) asks what the cash flows themselves are worth. You forecast free cash flow for an explicit period (typically 5–10 years), estimate a terminal value for everything beyond that, and discount it all back to today at a rate reflecting the risk. That rate is built on the risk-free rate: a common approach is the risk-free rate plus a beta-scaled equity risk premium (the CAPM). The mechanics are simple; the difficulty is that the answer is extremely sensitive to the inputs, so a DCF is best read as a range of plausible values built on explicit assumptions, not a single 'true' price.",
    keyPoints: [
      'Value today = the sum of future free cash flows, each discounted back at a rate that reflects time and risk.',
      "The discount rate starts with the risk-free rate — when the Fed moves rates, every DCF value moves with it. That's why long-duration growth stocks trade like long bonds.",
      'Terminal value usually makes up well over half of the total, so small changes in the growth or discount-rate assumption swing the result a lot.',
      "Run best, base, and worst cases and look for a margin of safety — a price comfortably below your base-case value that absorbs forecast errors.",
      "Use DCF and multiples as cross-checks: if a DCF says a stock is worth twice what peers' multiples imply, question the assumptions.",
    ],
    parentId: 'valuation-multiples', childIds: ['earnings-expectations'], relatedIds: ['risk-free-rate', 'central-banks', 'duration-risk', 'volatility-beta'],
    linkTab: 'dcf', linkLabel: 'Open DCF Valuation',
    liveStat: {
      endpoint: `/api/dcf/prefill/${EXAMPLE_SYMBOL}`,
      parse: (d) => {
        if (d.eps_ttm == null) return null
        const parts = [
          d.growth_rate != null && `growth input ${(d.growth_rate * 100).toFixed(1)}%`,
          d.beta != null && `beta ${d.beta.toFixed(2)}`,
        ].filter(Boolean)
        return {
          label: `${EXAMPLE_SYMBOL}: starting inputs for a DCF`,
          value: `EPS $${d.eps_ttm.toFixed(2)} (trailing)`,
          sub: parts.length ? `${parts.join(' · ')} — the growth and beta assumptions are what a DCF is most sensitive to` : undefined,
        }
      },
    },
  },
  'earnings-expectations': {
    id: 'earnings-expectations', layer: 'analysis', title: 'Earnings, Expectations & Guidance',
    oneLiner: 'Stocks move on results versus expectations — not on whether the results were good.',
    summary: "Prices already reflect what the market expects, so an earnings report moves a stock by the surprise: actual results versus the consensus analyst estimate. A company can report record profit and still fall if it merely met a very high bar. Guidance — management's outlook for coming quarters — often matters more than the quarter just reported, because valuation is about the future. Investors also look at the quality of a beat: revenue-driven beats are stronger than ones produced by cost cuts or buybacks. After a surprise, prices have historically tended to keep drifting in the same direction for days or weeks (post-earnings-announcement drift), though the effect is modest and has faded as markets became more efficient.",
    keyPoints: [
      'EPS surprise % = (actual − consensus estimate) ÷ estimate. The reaction depends on the surprise, not on the absolute result.',
      "Guidance often outweighs the quarter itself: a 'beat and lower guidance' frequently sells off, and companies often guide conservatively so they can beat.",
      'Check the quality of the beat — revenue growth is stronger evidence than lower costs or a shrinking share count.',
      'Options prices imply an expected earnings move, and implied volatility typically collapses right after the report — see Volatility & Beta and Derivatives.',
      'Consistent beats are often already priced in: a stock can rise less on a beat than it falls on a miss.',
    ],
    parentId: 'dcf-intrinsic-value', childIds: [], relatedIds: ['volatility-beta', 'derivatives', 'equities'],
    linkTab: 'earningssurprise', linkLabel: 'Open Earnings Surprise Tracker',
    liveStat: {
      endpoint: `/api/market/earnings-surprise?symbols=${EXAMPLE_SYMBOL}`,
      parse: (d) => {
        const r = Array.isArray(d) ? d.find(x => x.symbol === EXAMPLE_SYMBOL) : null
        if (!r || !r.totalQuarters) return null
        const sign = (v) => (v == null ? null : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`)
        const surprise = sign(r.avgSurprisePct), drift = sign(r.avgDrift1d)
        return {
          label: `${EXAMPLE_SYMBOL}: earnings beats, last ${r.totalQuarters} quarters`,
          value: `${r.beatCount} of ${r.totalQuarters} beat`,
          sub: [surprise && `Avg EPS surprise ${surprise}`, drift && `avg next-day move ${drift}`].filter(Boolean).join(' · ') || undefined,
        }
      },
    },
  },
}
