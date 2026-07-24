# HAQ Lab PBL Site
Nós estamos apoiar programas en regiões diferentes com múltiplo línguas en nosso interface de usuário & primário documentação. Por favor selecione-a na mantida 'README' línguas:
<br>
[![en](https://img.shields.io/badge/lang-en-red.svg)](https://github.com/HanniganAirQuality/PBLinRuralSchools/tree/main/README.md)
[![pt-br](https://img.shields.io/badge/lang-pt--br-green.svg)](https://github.com/HanniganAirQuality/PBLinRuralSchools/tree/main/README.pt-BR.md)
<br>

Tradução para o Português por Percy Smith em 24/07/2026 (Aviso: as novas atualizações serão menos frequentes, pois a língua principal de desenvolvimento é o inglês)

Estático site para nosso programa aprendizagem baseada em projetos (EN: 'HAQ Lab PBL' program), administrado en 'GitHub Pages'.
[https://hanniganairquality.github.io/PBLinRuralSchools/](https://hanniganairquality.github.io/PBLinRuralSchools/)

## Estrutura
```text
pbl.haq-lab.github.io/
|-- index.html                  Site Índice 
|-- aqiq/
|   |-- index.html              Centro site: **Pergunte Ao Ar** (EN: 'Air Quality InQuiry (AQIQ)')
|   `-- tools/
|       |-- data-plotter/
|       |   `-- index.html      Plotadora estática
|       `-- live-viewer/
|           `-- index.html      Visualização ao vivo (YPOD)
|-- fire-iq/
|   |-- index.html              Centro site: **Pergunte Ao Fogo** (EN: 'Fire InQuiry (Fire-IQ)')
|   `-- tools/
|       |-- data-plotter/
|       |   `-- index.html      Plotadora estática 
|       `-- live-viewer/
|           `-- index.html      Visualização ao vivo dupla (2x Fire YPOD)
|-- sqiq/
|   |-- index.html              Centro site: **Pergunte Ao Terra** (EN: 'Soil Quality InQuiry (SQIQ)')
|   `-- tools/
|       `-- live-viewer/
|           `-- index.html      Visualização ao vivo (SPOD)
|-- water-iq/
|   `-- index.html              *Em construção: Pergunte Ao Água (EN: 'Water Quality InQuiry (WQIQ)')*
|-- assets/
|   |-- css/
|   |-- generated/
|   |-- js/
|   |   |-- core/
|   |   `-- viewers/
|   `-- vendor/
|-- .github/
|   `-- workflows/
`-- .nojekyll
```

## Detalhes do Programa

| Programa  | Instrumento   | Estado        | Ferramentas                                           |
| ---       | ---           | ---           | ---                                                   |
| AQIQ      | YPOD          | Activa        | Visualização ao vivo, Plotadora estática              |
| Fire-IQ   | YPOD mod      | Activa        | Live Viewer, Data Plotter                             |
| SQIQ      | SPOD          | Activa        | Live Viewer                                           |
| WQIQ      | TBD           | Em construção | Future tools                                          |

## Live Viewer

Visualização ao vivo de Pergunte Ao Ar (EN: 'Air Quality InQuiry (AQIQ)') é uma aplicação de Web estática que utilize Portas Seriais para apresentar os dados de um monitor de qualidade do ar (YPOD). Por padrão, utiliza taxa de bauds de 9600, carrega a última entrada de `YPOD_*` em `YPOD_HeaderLog.yaml` no `HanniganAirQuality/All-POD-YAMLs` repositório, e analisa os CSV inserções nesse formato. Linhas com entrada de `Firmware_Version` passará para a versão automaticamente; linhas antigos sem metadados de versão vão durar seleção do usuário. As novas versões do YAML dão preferência a `Calibrated`; as versões antigas recorrem a `Serial_Calibrate` ou `Serial`. As configurações avançadas permitem selecionar a versão do YAML, seção de dados, janela de tempo, e gráficos visíveis.

Visualização ao vivo de Pergunte Ao Fogo (EN: 'Fire InQuiry (Fire-IQ)') é uma aplicação de Web estática que utilize Portas Seriais para apresentar dados em dois monitores de qualidade do ar (YPOD, modificado). Ele utiliza o `YPOD_HeaderLog.yaml` e idêntico mapeamento da versão do firmware, com a diferença de que utiliza dois monitores e exibe os valores de CO, CO₂ e PM2,5. 

Visualização ao vivo de Pergunte Ao Terra (EN: 'Soil Quality InQuiry (SQIQ)') é uma aplicação de Web estática que utilize Portas Seriais para apresentar os dados de um monitor de qualidade do terra. Ele utiliza o `SPOD_HeaderLog.yaml` e é compatível tanto com a versão 1,0 como com a versão 2,0. A aplicação apresenta gráficos da temperatura, do CO₂, da humidade do solo e da luz visível, infravermelha e ultravioleta. 

## Informações Administrativas 

Administrado en 'GitHub Pages'. Requer HTTPS para 'API Web Serial', que é fornecida automaticamente no `*.github.io`.

## HAQ Lab, Universidade do Colorado 