// Referencias del Excel original; los valores del corte Datos tienen prioridad.
export const catalogo: { materials: Record<string, {factor:number;hl:number;categoria:string}>; centers: Record<string,string> } = {
  "materials": {
    "26": {
      "factor": 1,
      "hl": 0.5,
      "categoria": "Cervezas"
    },
    "27": {
      "factor": 1,
      "hl": 0.5,
      "categoria": "Cervezas"
    },
    "31": {
      "factor": 1,
      "hl": 0.3,
      "categoria": "Cervezas"
    },
    "1413": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "1416": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "1421": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "1428": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2157": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2160": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2169": {
      "factor": 12,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2170": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2171": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2173": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2174": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2182": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Maltas"
    },
    "2183": {
      "factor": 38,
      "hl": 0.00225,
      "categoria": "Maltas"
    },
    "2206": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Maltas"
    },
    "2222": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Maltas"
    },
    "2223": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Maltas"
    },
    "2224": {
      "factor": 6,
      "hl": 0.015,
      "categoria": "Maltas"
    },
    "2298": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2302": {
      "factor": 24,
      "hl": 0.0025,
      "categoria": "Cervezas"
    },
    "2511": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2512": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2634": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2641": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "2759": {
      "factor": 6,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "2882": {
      "factor": 6,
      "hl": 0.015,
      "categoria": "Cervezas"
    },
    "2976": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3059": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3128": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3130": {
      "factor": 38,
      "hl": 0.00225,
      "categoria": "Cervezas"
    },
    "3162": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3164": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3198": {
      "factor": 30,
      "hl": 0.0035,
      "categoria": "Cervezas"
    },
    "3203": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "3228": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "3229": {
      "factor": 12,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3232": {
      "factor": 12,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3583": {
      "factor": 16,
      "hl": 0.0075,
      "categoria": "Cervezas"
    },
    "3617": {
      "factor": 38,
      "hl": 0.00175,
      "categoria": "Cervezas"
    },
    "3656": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "3658": {
      "factor": 16,
      "hl": 0.0075,
      "categoria": "Cervezas"
    },
    "3659": {
      "factor": 16,
      "hl": 0.0075,
      "categoria": "Cervezas"
    },
    "3664": {
      "factor": 16,
      "hl": 0.0075,
      "categoria": "Cervezas"
    },
    "3751": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3753": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3756": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3758": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3759": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3760": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3787": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3788": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3789": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "3810": {
      "factor": 30,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "4044": {
      "factor": 1,
      "hl": 0.3,
      "categoria": "Cervezas"
    },
    "4477": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "5119": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5150": {
      "factor": 6,
      "hl": 0.00473,
      "categoria": "Cervezas"
    },
    "5250": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5251": {
      "factor": 12,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5252": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5253": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5254": {
      "factor": 12,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5255": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5256": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5257": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5268": {
      "factor": 18,
      "hl": 0.00473,
      "categoria": "Cervezas"
    },
    "5506": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5624": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "5632": {
      "factor": 6,
      "hl": 0.00473,
      "categoria": "Cervezas"
    },
    "5768": {
      "factor": 38,
      "hl": 0.00175,
      "categoria": "Cervezas"
    },
    "5902": {
      "factor": 6,
      "hl": 0.00473,
      "categoria": "Cervezas"
    },
    "5903": {
      "factor": 18,
      "hl": 0.00473,
      "categoria": "Cervezas"
    },
    "5904": {
      "factor": 18,
      "hl": 0.00473,
      "categoria": "Cervezas"
    },
    "5905": {
      "factor": 18,
      "hl": 0.00473,
      "categoria": "Cervezas"
    },
    "6819": {
      "factor": 1,
      "hl": 0.2,
      "categoria": "Cervezas"
    },
    "7078": {
      "factor": 15,
      "hl": 0.01,
      "categoria": "Maltas"
    },
    "7410": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7474": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7475": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7476": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7487": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "7576": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "7577": {
      "factor": 12,
      "hl": 0.0071,
      "categoria": "Cervezas"
    },
    "7581": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7584": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "7594": {
      "factor": 4,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7596": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7599": {
      "factor": 4,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7601": {
      "factor": 4,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7603": {
      "factor": 4,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7605": {
      "factor": 4,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7609": {
      "factor": 12,
      "hl": 0.00295,
      "categoria": "Cervezas"
    },
    "7611": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7613": {
      "factor": 6,
      "hl": 0.00207,
      "categoria": "Cervezas"
    },
    "7614": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "7660": {
      "factor": 4,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "7780": {
      "factor": 1,
      "hl": 0.3,
      "categoria": "Cervezas"
    },
    "7782": {
      "factor": 1,
      "hl": 0.3,
      "categoria": "Cervezas"
    },
    "7790": {
      "factor": 1,
      "hl": 0.3,
      "categoria": "Cervezas"
    },
    "7807": {
      "factor": 1,
      "hl": 0.3,
      "categoria": "Cervezas"
    },
    "7836": {
      "factor": 1,
      "hl": 0.3,
      "categoria": "Cervezas"
    },
    "7857": {
      "factor": 1,
      "hl": 0.3,
      "categoria": "Cervezas"
    },
    "7872": {
      "factor": 38,
      "hl": 0.00225,
      "categoria": "Cervezas"
    },
    "7990": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "7991": {
      "factor": 24,
      "hl": 0.0025,
      "categoria": "Cervezas"
    },
    "7993": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "7994": {
      "factor": 24,
      "hl": 0.00315,
      "categoria": "Cervezas"
    },
    "7996": {
      "factor": 12,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "8042": {
      "factor": 6,
      "hl": 0.0025,
      "categoria": "Cervezas"
    },
    "8061": {
      "factor": 6,
      "hl": 0.00315,
      "categoria": "Cervezas"
    },
    "8063": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8065": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8066": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8070": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8071": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8072": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8073": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8074": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8075": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8085": {
      "factor": 4,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "8135": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8136": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8156": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8157": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8160": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8161": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8163": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8165": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8180": {
      "factor": 6,
      "hl": 0.0075,
      "categoria": "Cervezas"
    },
    "8212": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "8213": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "8221": {
      "factor": 6,
      "hl": 0.00275,
      "categoria": "Cervezas"
    },
    "8307": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "8367": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8532": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "8567": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "8570": {
      "factor": 6,
      "hl": 0.0021,
      "categoria": "Cervezas"
    },
    "8573": {
      "factor": 24,
      "hl": 0.0021,
      "categoria": "Cervezas"
    },
    "8722": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "8723": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "8813": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8814": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "8815": {
      "factor": 6,
      "hl": 0.00275,
      "categoria": "Cervezas"
    },
    "8827": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "8828": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "8878": {
      "factor": 6,
      "hl": 0.004,
      "categoria": "Maltas"
    },
    "8880": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Maltas"
    },
    "8881": {
      "factor": 24,
      "hl": 0.004,
      "categoria": "Maltas"
    },
    "8923": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9084": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9127": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9128": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9129": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9139": {
      "factor": 38,
      "hl": 0.0025,
      "categoria": "Cervezas"
    },
    "9141": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "9142": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9143": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9150": {
      "factor": 38,
      "hl": 0.0025,
      "categoria": "Cervezas"
    },
    "9480": {
      "factor": 13,
      "hl": 0.01,
      "categoria": "Cervezas"
    },
    "9482": {
      "factor": 13,
      "hl": 0.01,
      "categoria": "Cervezas"
    },
    "9484": {
      "factor": 13,
      "hl": 0.01,
      "categoria": "Cervezas"
    },
    "9494": {
      "factor": 13,
      "hl": 0.01,
      "categoria": "Cervezas"
    },
    "9500": {
      "factor": 12,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "9504": {
      "factor": 6,
      "hl": 0.015,
      "categoria": "Maltas"
    },
    "9508": {
      "factor": 6,
      "hl": 0.0021,
      "categoria": "Cervezas"
    },
    "9509": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "9529": {
      "factor": 4,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9551": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9553": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "9557": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9581": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9672": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "9675": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9793": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9794": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9798": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9799": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9800": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9801": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9845": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9846": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9847": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9849": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9851": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9856": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9857": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9858": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9893": {
      "factor": 1,
      "hl": 0.12,
      "categoria": "Cervezas"
    },
    "9909": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "9963": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "9965": {
      "factor": 6,
      "hl": 0.004,
      "categoria": "Cervezas"
    },
    "11120": {
      "factor": 12,
      "hl": 0.01,
      "categoria": "Cervezas"
    },
    "11123": {
      "factor": 12,
      "hl": 0.01,
      "categoria": "Cervezas"
    },
    "11162": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "11173": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "11176": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "11177": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "11180": {
      "factor": 24,
      "hl": 0.0021,
      "categoria": "Cervezas"
    },
    "11182": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "11772": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "11853": {
      "factor": 30,
      "hl": 0.00175,
      "categoria": "Cervezas"
    },
    "11961": {
      "factor": 6,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "11962": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Maltas"
    },
    "11963": {
      "factor": 30,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "11964": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Maltas"
    },
    "11969": {
      "factor": 6,
      "hl": 0.02,
      "categoria": "Maltas"
    },
    "12012": {
      "factor": 4,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "12013": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "12026": {
      "factor": 12,
      "hl": 0.006,
      "categoria": "Aguas"
    },
    "12029": {
      "factor": 24,
      "hl": 0.006,
      "categoria": "Agua"
    },
    "12117": {
      "factor": 2,
      "hl": 0.02,
      "categoria": "Maltas"
    },
    "12118": {
      "factor": 15,
      "hl": 0.01,
      "categoria": "Maltas"
    },
    "12135": {
      "factor": 24,
      "hl": 0.0025,
      "categoria": "Agua"
    },
    "12136": {
      "factor": 6,
      "hl": 0.0025,
      "categoria": "Cervezas"
    },
    "12137": {
      "factor": 12,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "12212": {
      "factor": 24,
      "hl": 0.0025,
      "categoria": "Cervezas"
    },
    "12271": {
      "factor": 6,
      "hl": 0.0032,
      "categoria": "Cervezas"
    },
    "12273": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "12275": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "12279": {
      "factor": 6,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "12280": {
      "factor": 6,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "12283": {
      "factor": 4,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "12388": {
      "factor": 3,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "12398": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "13413": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "13443": {
      "factor": 6,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "13451": {
      "factor": 30,
      "hl": 0.0032,
      "categoria": "Cervezas"
    },
    "13631": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "13763": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "13798": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "14197": {
      "factor": 24,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "14603": {
      "factor": 6,
      "hl": 0.015,
      "categoria": "Agua"
    },
    "14646": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "14647": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "14703": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "14706": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "14707": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "14709": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "14779": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "14798": {
      "factor": 4,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "14968": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "14969": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "15007": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "15012": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "15015": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "15024": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "15070": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "15366": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "15367": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "15545": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "15781": {
      "factor": 13,
      "hl": 0.0085,
      "categoria": "Cervezas"
    },
    "15854": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "15859": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "15860": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16017": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16018": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16198": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16210": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Maltas"
    },
    "16282": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16396": {
      "factor": 2,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "16398": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Maltas"
    },
    "16466": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16542": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Maltas"
    },
    "16589": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16590": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16641": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16920": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16950": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "16951": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "16952": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "16953": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "16992": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "16993": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "17154": {
      "factor": 24,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "17155": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "17157": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "17290": {
      "factor": 4,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "17594": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "18039": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "18059": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "18216": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "18217": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "18218": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "18220": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "18224": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "18226": {
      "factor": 12,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "19184": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "19303": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "19596": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "19898": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "19954": {
      "factor": 38,
      "hl": 0.0025,
      "categoria": "Cervezas"
    },
    "20004": {
      "factor": 12,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "20012": {
      "factor": 4,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "20013": {
      "factor": 4,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "20014": {
      "factor": 4,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "20016": {
      "factor": 4,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "20050": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "20254": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "20463": {
      "factor": 6,
      "hl": 0.003,
      "categoria": "Cervezas"
    },
    "20469": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "20546": {
      "factor": 38,
      "hl": 0.0025,
      "categoria": "Cervezas"
    },
    "20867": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "20877": {
      "factor": 16,
      "hl": 0.0075,
      "categoria": "Cervezas"
    },
    "21146": {
      "factor": 6,
      "hl": 0.00473,
      "categoria": "Cervezas"
    },
    "21155": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "21156": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "21161": {
      "factor": 4,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "21173": {
      "factor": 15,
      "hl": 0.01,
      "categoria": "Maltas"
    },
    "21177": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "21189": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "21255": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "21447": {
      "factor": 6,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "21703": {
      "factor": 6,
      "hl": 0.02,
      "categoria": "Maltas"
    },
    "21730": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "21959": {
      "factor": 15,
      "hl": 0.015,
      "categoria": "Maltas"
    },
    "22006": {
      "factor": 12,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "22102": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "22135": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "22202": {
      "factor": 1,
      "hl": 0.297,
      "categoria": "Cervezas"
    },
    "22242": {
      "factor": 6,
      "hl": 0.00269,
      "categoria": "Cervezas"
    },
    "22265": {
      "factor": 6,
      "hl": 0.0031,
      "categoria": "Cervezas"
    },
    "22269": {
      "factor": 6,
      "hl": 0.0031,
      "categoria": "Cervezas"
    },
    "22270": {
      "factor": 6,
      "hl": 0.0031,
      "categoria": "Cervezas"
    },
    "22315": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "22398": {
      "factor": 6,
      "hl": 0.00355,
      "categoria": "Cervezas"
    },
    "22579": {
      "factor": 6,
      "hl": 0.00473,
      "categoria": "Cervezas"
    },
    "22613": {
      "factor": 30,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "22616": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "22866": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "22867": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "23013": {
      "factor": 6,
      "hl": 0.0031,
      "categoria": "Cervezas"
    },
    "23047": {
      "factor": 6,
      "hl": 0.0031,
      "categoria": "Cervezas"
    },
    "23060": {
      "factor": 1,
      "hl": 0.3,
      "categoria": "Cervezas"
    },
    "23121": {
      "factor": 6,
      "hl": 0.0033,
      "categoria": "Cervezas"
    },
    "23204": {
      "factor": 6,
      "hl": 0.0021,
      "categoria": "Cervezas"
    },
    "23211": {
      "factor": 30,
      "hl": 0.002,
      "categoria": "Maltas"
    },
    "23425": {
      "factor": 24,
      "hl": 0.0033,
      "categoria": "Cervezas"
    }
  },
  "centers": {
    "AV10": "Turbaco",
    "AV11": "Santa Marta",
    "AV12": "Valledupar",
    "AV13": "Corozal",
    "AV20": "Cúcuta",
    "AV29": "San Andrés",
    "AV30": "Riohacha",
    "AV32": "Magangué",
    "AV36": "Fonseca",
    "AV38": "Curumaní",
    "AV39": "Montería",
    "AV40": "Caucasia",
    "AV41": "Apartadó",
    "AV48": "Cartagena KA",
    "AV69": "UDC Torices",
    "AV74": "La Árenosa",
    "AV76": "Galapa"
  }
};
