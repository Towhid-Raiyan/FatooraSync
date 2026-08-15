export interface Dictionary {
  nav: {
    home: string;
    newReceipt: string;
    newQuotation: string;
    products: string;
    customers: string;
    receiptHistory: string;
    quotationHistory: string;
    settings: string;
  };
  common: {
    save: string;
    savingEllipsis: string;
    edit: string;
    deactivate: string;
    reactivate: string;
    actions: string;
    showInactive: string;
    somethingWentWrong: string;
    addProduct: string;
    view: string;
    download: string;
    previous: string;
    next: string;
    loading: string;
    to: string;
    poweredBy: string;
    signOut: string;
    pageOf: (page: number, totalPages: number) => string;
    totalMatches: (count: number) => string;
  };
  home: {
    welcomeBack: string;
    products: string;
    customers: string;
  };
  login: {
    title: string;
    subtitle: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    invalidCredentials: string;
    signIn: string;
  };
  settings: {
    title: string;
    defaultVatRate: string;
    language: string;
    languageCaption: string;
    businessPhone: string;
    printFormat: string;
    thermal: string;
    a4: string;
    saveChanges: string;
    cashierCanManageCatalog: string;
    savedToast: string;
    saveError: string;
  };
  products: {
    searchPlaceholder: string;
    noProductsYet: string;
    sku: string;
    barcode: string;
    name: string;
    unit: string;
    unitPrice: string;
    vat: string;
    quantity: string;
    defaultBadge: string;
    dialogTitleEdit: string;
    dialogTitleAdd: string;
    nameEn: string;
    nameAr: string;
    useDefaultVat: string;
    vatRate: string;
    units: { piece: string; kg: string; box: string; carton: string; liter: string };
    savedToast: string;
    statusUpdatedToast: string;
  };
  customers: {
    searchPlaceholder: string;
    noCustomersYet: string;
    name: string;
    vatId: string;
    crNumber: string;
    phone: string;
    address: string;
    systemBadge: string;
    dialogTitleEdit: string;
    dialogTitleAdd: string;
    savedToast: string;
    statusUpdatedToast: string;
  };
  documentForm: {
    customerSection: {
      title: string;
      name: string;
      vatId: string;
      crNumber: string;
      phone: string;
      address: string;
    };
    itemsSection: {
      title: string;
      searchPlaceholder: string;
      noMatches: string;
      exceedsStock: string;
      exceedsSubtotal: string;
      headers: {
        number: string;
        sku: string;
        product: string;
        unit: string;
        qty: string;
        price: string;
        disc: string;
        vat: string;
        total: string;
        actions: string;
      };
    };
    notesTitle: string;
    totals: {
      title: string;
      subtotal: string;
      totalVat: string;
      grandTotal: string;
      savePrint: string;
      addAtLeastOneItem: string;
    };
  };
  receiptHistory: {
    searchPlaceholder: string;
    noMatching: string;
    noneYet: string;
    number: string;
    customer: string;
    date: string;
    total: string;
    loadError: string;
  };
  quotationHistory: {
    searchPlaceholder: string;
    noMatching: string;
    noneYet: string;
    number: string;
    customer: string;
    date: string;
    total: string;
    loadError: string;
  };
  printChrome: {
    print: string;
    receiptTitle: string;
    quotationTitle: string;
  };
  staff: {
    title: string;
    addCashier: string;
    noCashiersYet: string;
    email: string;
    password: string;
    dialogTitle: string;
    activeBadge: string;
    inactiveBadge: string;
    passwordRules: {
      minLength: string;
      uppercase: string;
      number: string;
      special: string;
    };
    cashierAddedToast: string;
    statusUpdatedToast: string;
  };
  billing: {
    blockedTitle: string;
    blockedMessage: string;
    signOut: string;
  };
  a11y: {
    language: string;
    comingSoon: string;
    confirmLine: string;
    removeItem: string;
    close: string;
  };
}
