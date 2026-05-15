<style>
	.outerNtf
	{
		width:250px; /*309*/
		
		display: none;
		position: absolute;
		z-index: 3000;
				
		background: #DDDDDD;
		background: linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		background: -o-linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		background: -ms-linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		background: -moz-linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		background: -webkit-linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		box-shadow: 0 6px 15px rgba(0,0,0,0.40);
		-o-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		-ms-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		-moz-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		-webkit-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
	}
			
	.ntf_header
	{
		border-bottom:1px solid #888888;
		background: #90A9C3;
		background: linear-gradient(#90A9C3 0, #90AAC5 50px);
		background: -o-linear-gradient(#90A9C3 0, #90AAC5 50px);
		background: -ms-linear-gradient(#90A9C3 0, #90AAC5 50px);
		background: -moz-linear-gradient(#90A9C3 0, #90AAC5 50px);
		background: -webkit-linear-gradient(#90A9C3 0, #90AAC5 50px);
	}
</style>

<div style="float:right; width:65px; height:56px">&nbsp;</div>    

					<div style="float:right; width:18px; height:56px; padding:18px 0px 0px 0px; background-image:url(image/separaqdor_user.png)"></div>
					
					<!--  Foto de perfil -->
					<div style="float:right; padding:26px 10px 0px 0px">
						<a  id="perfil" class="txt_negro_bold_12" href="#prf" onClick="getNtf( this.id )" title="Ir al Perfil"  style="text-decoration:none;  margin-left:10px;"  id="<?PHP echo $curso['Id']?>" name="<?PHP echo $user ?>" >
							<img id="p_foto_header" src="<?PHP echo $Foto_User ?>" width="40" height="39" border="0" style="border-radius:5px; box-shadow: 1px 0px 5px 0px rgba(33,33,33,1);" />
						</a>
						<input type="hidden" name="p_root" id="p_root" value="<?PHP echo $Foto_User ?>" />
						<input type="hidden" name="uid" id="uid" value="<?PHP echo $data_user_in[0] ?>" />
					</div>
					<!-- Nombre de Usuario -->
					<div  class="txt_user_12" style="float:right; height:16px; padding:40px 5px 0px 0px; color:#7B9BBB;"><?PHP echo  $user_name ?> de <?PHP echo  $user_sede ?></div>
					
						<!-- Notificaciones  onClick="getNtf( this.id )" -->
						<div id="ntf_a"   style="float:right; height:16px; padding:31px 5px 0px 0px; cursor:pointer;" class="txt_user_12">
							<img src="images/header/Notificacion.png" border="0" style="" />
						</div>
						
						<!-- Widget de Notificaciones - Panel de Atencion al Paciente -->
						<div id="notification-widget-container" style="float:right; height:16px; padding:24px 8px 0px 0px;"></div>
						
						<!-- Backup  -->
						<div id="ntf_bk" onClick="getNtf( this.id )" style="float:right; height:16px; padding:31px 0px 0px 0px; cursor:pointer;" class="txt_user_12">
							<img src="images/header/Bk.png"  border="0" style="" />
						</div>
					
					
<div class="outerNtf">
	<div class="ntf_header" style="height:40px; opacity:0.6;" >
		<div class="ntf_tittle" style="float:left;"></div>
		<div style="float:right; padding-right:18px; padding-top:5px;">
		
		</div>
	</div>
	<div id="content_ntf" style="float:left; min-height:300px; width:100%; text-align:center; opacity:1;"></div>
</div>
<style>
	.buttom-confirm-sesion{
				width:35px;
				height:25px;
				margin:10px;
				padding-top:3px;
				padding-bottom:3px;
				padding-left:20px;
				padding-right:20px;
				border: 1px solid #787878;
				background: #DDDDDD;
				border-radius:4px;
				color:#000;
				text-decoration:none;
				cursor:pointer;
				font-family:Arial, Helvetica, Sans;
				font-size:13px;
	}

	.buttom-confirm-sesion:hover{
		background: #787878;
		color:#fff;
	}
	
	.buttom-confirm-sesion-logout{
				width:35px;
				height:25px;
				margin:10px;
				padding-top:3px;
				padding-bottom:3px;
				padding-left:20px;
				padding-right:20px;
				border: 1px solid #787878;
				
				background: #C3CEE1;
				background: linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				background: -o-linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				background: -ms-linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				background: -moz-linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				background: -webkit-linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				border-radius:4px;
				color:#000;
				text-decoration:none;
				cursor:pointer;
				font-family:Arial, Helvetica, Sans;
				font-size:13px;
	}

	.buttom-confirm-sesion-logout:hover{
		background: #fff;
		color:#000;
	}
	
	#chgn_picture{
	background-image: url('images/grales/camera.png');
	width:18px;
	height:18px;
	}
	#chgn_picture:hover{
	background-image: url('images/grales/camera.png');
	margin-top:1px;
	}
	
	.pie-placeholder 
	{
		float:right;
		width: 70px;
		height: 70px;
		margin:0;
		margin-right:0px;
		margin-top:0px;
		font-size: 14px;
		line-height: 1.2em;
		padding:0;
	}
	
	#form_f_perfil input[type="file"] {
		display: none;
	}
	 
	.custom-file-upload-perfil {
		
		width:35px;
				margin:10px;
				padding-top:3px;
				padding-bottom:3px;
				padding-left:20px;
				padding-right:20px;
				border: 1px solid #787878;
				
				background: #C3CEE1;
				background: linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				background: -o-linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				background: -ms-linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				background: -moz-linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				background: -webkit-linear-gradient(#C3CEE1 0, #C3CEE1 50px);
				border-radius:4px;
				color:#000;
				text-decoration:none;
				
				font-family:Arial, Helvetica, Sans;
				font-size:13px;
		
		display: inline-block;
		transition: all .5s;
		cursor: pointer;
		width: fit-content;
		text-align: center;
	 }
	
	.custom-file-upload-perfil:hover
	{
		background: #fff;
		color:#000;
	}
</style>
<script>
	function getNtf( e )
	{
	
		/*Determina la altura de la practica seleccionada */
		var p = $j("#perfil").position();
		var inc = 0;
		
		/* Verifico navegador de cliente */
		var nav = navigator.userAgent.toLowerCase();
		if ( nav.indexOf('firefox') > -1  )
		{
			// Firefox
			inc = ( p.top == 51 ) ? 26 : 23;
		}
		else if( nav.indexOf('safari') != -1 )
		{
			if (nav.indexOf('chrome') > -1) 
			{
				
				// Chrome
				inc = ( p.top == 51 ) ? 24 : 21;
			} 
			else 
			{
				
				// Safari
				inc = ( p.top == 51 ) ? 29 : 25;
			 }
			
		}
	
		

		var top = p.top + inc;
		
		var out = 185;
		var left = p.left - out;
		//
		$j(".outerNtf").css("top", top+"px");	
		$j(".outerNtf").css("left", left+"px");	
		
		$j(".outerNtf").slideDown();
		
		
		gnrNtf( e );
		
	}
	
	function gnrNtf( e )
	{
		
		var estructura = '';
		var p_root = $j('#p_root').val();
		var uid = $j('#uid').val();
		switch( e )
		{
			case 'perfil':
				
				estructura 	=		'<div style="position:absolutgnrNtfe; left:90px; top: 20px;">';
				estructura 	+= 	'<img id="p_foto" src="'+p_root+'" width="70" height="69" border="0" style="border-radius:5px;  box-shadow: 1px 0px 5px 0px rgba(33,33,33,1); " />'; // box-shadow: 1px 0px 5px 0px rgba(33,33,33,1); rgba(169,169,169,1); rgba(123,155,187,1);
				estructura 	+= 	'</div>';
				
				estructura 	+=		'<div  id="chgn_picture" onClick="gnrNtf( \'ntf_pp\' );"  style="position:absolute; left:154px; top: 78px; cursor:pointer; " >';
				//estructura 	+= 	'<img id="chgn_picture" src="images/grales/camera.png" width="24" height="24" border="0" style="cursor:pointer; " />'; // box-shadow: 1px 0px 5px 0px rgba(33,33,33,1); rgba(169,169,169,1); rgba(123,155,187,1);
				estructura 	+= 	'</div>';
				
				estructura 	+= 	'<div style="position:left; width:100%; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; padding-top:30px; font-weight:700;"><?= $data_user_in[3].', '. $data_user_in[2];?></div>';
				
				estructura 	+= 	'<div style="position:left; width:100%; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e;  padding-top:10px; font-weight:700;"><?= $data_user_in[5];?></div>';
				estructura 	+= 	'<div style="position:left; width:100%; padding-top:30px;"></div>';
				
				estructura 	+= 	'<div style="float:left; width:100%;" >';
				estructura 	+= 	'<a href="javascript:gnrNtf( \'ntf_p\' );" class="buttom-confirm-sesion"   >';
				estructura 	+= 	'Mi perfil';
				estructura 	+= 	'</a>';
				estructura 	+= 	'</div>'; 
						
				estructura 	+= 	'<div style="float:left; width:100%; margin-top:15px;" >';
				estructura 	+= 	'<a href="javascript:popMe(\'ayudantes_asignados.php?acc=agd&uid='+uid+'\')" class="buttom-confirm-sesion"   >';
				estructura 	+= 	'Mis ayudantes';
				estructura 	+= 	'</a>';
				estructura 	+= 	'</div>'; 
				
				estructura 	+= 	'<div style="float:left; width:100%; margin-top:15px; "  >';
				estructura 	+= 	'<a href="?session_off=1&idu=<?PHP echo $data_user_in[0]; ?>" class="buttom-confirm-sesion-logout" >';
				estructura 	+= 	'Cerrar sesi&oacute;n';
				estructura 	+= 	'</a>';
				estructura 	+= 	'</div>'; 
			
				
				break;
			case 'ntf_bk':
				estructura = _contruct_bkup();
				break;
			case 'ntf_a':
				break;
			/* Notificacion de perfil */	
			case 'ntf_p':
				estructura = _contruct_perfil();
				break;
			/* Notificacion de ayudantes */	
			case 'ntf_ayu':
				estructura = _contruct_ayudante();
				break;
			/* Notificacion de picture perfil */	
			case 'ntf_pp':
				estructura = _contruct_picture();
				break;
		}
		
		$j("#content_ntf").html( estructura );
		
		
	
		switch( e )
		{
			case 'ntf_bk':
				createGraph();
				break;
			case 'ntf_p':
				loadPerfil();
				break;
		}
	}
	
	/* funcion de contruccion de backup*/
	function _contruct_bkup()
	{
		var est = "";
		
		est 	+=	
		est 	+= 	'<div style="position:absolute; left:64px; top: 10px; font-family:Arial, Helvetica, Sans; color:#d8deea; text-shadow: 1px 1px 1px #000; ">';
		est 	+=		'Salud del sistema';
		est 	+=	'</div>';
		
		<!-- Begin Backup online -->
		
		est 	+= 	'<div style="position:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; padding-top:10px; font-weight:700;">';
		est 	+=		'&squf; Backup Online <span id="service_online_bk"></span>';
		est 	+= 	'</div>';
		
		est 	+= 	'<div style="position:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:11px; color:#000; padding-top:10px; font-weight:100;">';
		est 	+=		'Status: <span id="BK_Online_Status"  style="font-weight:700;"></span>';
		est 	+= 	'</div>';
		
		est 	+= 	'<div style="position:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:11px; color:#000; padding-top:5px; font-weight:100;">';
		est 	+=		'&Uacute;ltima sincronizaci&oacute;n: <span id="BK_Online_Fecha"  style="font-weight:700;"></span>';
		est 	+= 	'</div>';
		<!-- End Backup online -->
		
		<!-- Begin Backup local -->
		est 	+= 	'<div style="position:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; padding-top:15px; font-weight:700;">';
		est 	+=		'&squf; Backup Local <span id="service_local_bk"></span>';
		est 	+= 	'</div>';
		  
		est 	+= 	'<div style="position:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:11px; color:#000; padding-top:10px; font-weight:100;">';
		est 	+=		'Status: <span id="BK_Local_Status" style="font-weight:700;"></span>';
		est 	+= 	'</div>';
		
		est 	+= 	'<div style="position:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:11px; color:#000; padding-top:5px; font-weight:100;">';
		est 	+=		'&Uacute;ltima sincronizaci&oacute;n: <span id="BK_Local_Fecha"  style="font-weight:700;"></span>';
		est 	+= 	'</div>';	
		<!-- End Backup local -->
		
		<!-- Begin Estado disco-->
		est 	+= 	'<div style="position:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; padding-top:15px; font-weight:700;">';
		est 	+=		'&squf; Espacio de Disco';
		est 	+= 	'</div>';
		
		est 	+= 	'<div id="leyenda_space_disk" style="float:left; width:64%; clear:none; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:11px; color:#000; padding-top:5px; font-weight:100;">';
		est 	+= 	'</div>';	
		est 	+= 	'<div id="graph_space_disk" class="pie-placeholder" style="float:left; width:26%; margin-top:20px; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:11px; color:#000; padding-top:5px; font-weight:100;">';
		est 	+= 	'</div>';	
		/*
		
		
		*/
		<!-- End Estado disco -->
		
		return est;
		
	}
	
	/* funcion de edicion de perfil*/
	function _contruct_perfil()
	{
		var est = "";
		
		est 	+=	
		est 	+= 	'<div style="position:absolute; left:84px; top: 10px; font-family:Arial, Helvetica, Sans; color:#d8deea; text-shadow: 1px 1px 1px #000; ">';
		est 	+=		'Editar perfil';
		est 	+=	'</div>';
		
		est 	+= 	'<form name="form_p" id="form_p" >'; 
		<!-- Usuario -->
		est 	+= 	'<div style="float:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; padding-top:15px; font-weight:700;">';
		est 	+=		'<span style="float:left; width:82px" >User <span style="font-size:10px; font-weight:100; color:#000;">(Local)</span>:</span>';
		est 	+=		'<input style="float:left; font-size:11px; width:140px; height:12px;" name="User" id="P_User" />';
		est 	+= 	'</div>';
		
		<!-- Pass -->
		//est 	+= 	'<div style="float:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; margin-top:6px; font-weight:700;">';
		//est 	+=		'<span style="float:left; width:82px" >Pass <span style="font-size:10px; font-weight:100; color:#000;">(Local)</span>:</span>';
		//est 	+=		'<input style="float:left; font-size:11px; width:140px; height:12px;" type="password"  name="Pass" id="P_Pass" />';
		//est 	+= 	'</div>';
		
		<!-- Sede -->
		est 	+= 	'<div style="float:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; margin-top:6px; font-weight:700;">';
		est 	+=		'<span style="float:left; width:82px" >Sede:</span>';
		est 	+=		'<span id="P_Sede_Select"></span>';
		est 	+= 	'</div>';
		
		<!-- Apellido -->
		est 	+= 	'<div style="float:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; margin-top:6px; font-weight:700;">';
		est 	+=		'<span style="float:left; width:82px" >Apellido:</span>';
		est 	+=		'<input style="float:left; font-size:11px;  width:140px; height:12px;" name="Apellido" id="P_Apellido" />';
		est 	+= 	'</div>';
		
		<!-- Nombres -->
		est 	+= 	'<div style="float:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; margin-top:6px; font-weight:700;">';
		est 	+=		'<span style="float:left; width:82px" >Nombres:</span>';
		est 	+=		'<input style="float:left; font-size:11px;    width:140px; height:12px;" name="Nombres" id="P_Nombres" />';
		est 	+= 	'</div>';
		
		<!-- Ocupacion  -->
		est 	+= 	'<div style="float:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; margin-top:6px; font-weight:700;">';
		est 	+=		'<span style="float:left; width:82px" >Ocupaci&oacute;n:</span>';
		est 	+=		'<input style="float:left; font-size:11px;    width:140px; height:12px;" name="Occupation" id="P_Occupation" />';
		est 	+= 	'</div>';
		
		<!-- Direccion   -->
		est 	+= 	'<div style="float:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; margin-top:6px; font-weight:700;">';
		est 	+=		'<span style="float:left; width:82px" >Direcci&oacute;n:</span>';
		est 	+=		'<input style="float:left; font-size:11px;    width:140px; height:12px;" name="Direccion" id="P_Direccion" />';
		est 	+= 	'</div>';
		
		<!-- Celular   -->
		est 	+= 	'<div style="float:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; margin-top:6px; font-weight:700;">';
		est 	+=		'<span style="float:left; width:82px" >Celular:</span>';
		est 	+=		'<input style="float:left; font-size:11px;    width:140px; height:12px;" name="Celular" id="P_Celular" />';
		est 	+= 	'</div>';
		
		<!-- Email  -->
		est 	+= 	'<div style="float:left; width:100%; text-align:left; padding-left:10px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; margin-top:6px; font-weight:700;">';
		est 	+=		'<span style="float:left; width:82px" >Email:</span>';
		est 	+=		'<input style="float:left; font-size:11px; width:140px; height:12px;" name="E_Mail" id="P_E_Mail" />';
		est 	+=		'<input type="hidden" name="acc" id="acc"  value="s_per" />';
		est 	+= 	'</div>';
		est 	+= 	'</form>'; 
		est 	+= 	'<div style="float:left; width:100%; margin-top:30px;" >';
		est 	+= 	'<a href="javascript:savePerfil( );" class="buttom-confirm-sesion"   >';
		est 	+= 	'Guardar cambios';
		est 	+= 	'</a>';
		est 	+= 	'</div>'; 
		return est;
	}
	
	/* funcion de edicion de ayudante*/
	function _contruct_ayudante()
	{
		var est = "";
		
		est 	+=	
		est 	+= 	'<div style="position:absolute; left:78px; top: 10px; font-family:Arial, Helvetica, Sans; color:#d8deea; text-shadow: 1px 1px 1px #000; ">';
		est 	+=		'Mis ayudantes';
		est 	+=	'</div>';
		
		return est;
	}
	
	/* funcion de edicion de ayudante*/
	function _contruct_picture()
	{
		
		var p_root = $j('#p_root').val();
		
		var est = "";
		
		
		est 	+=	
		est 	+= 	'<div style="position:absolute; left:74px; top: 10px; font-family:Arial, Helvetica, Sans; color:#d8deea; text-shadow: 1px 1px 1px #000; ">';
		est 	+=		'Foto de perfil';
		est 	+=	'</div>';
		
		est 	+=		'<div style="float:left; width:100%; text-align:left; padding-left:75px; font-family:Arial, Helvetica, Sans; font-size:13px; color:#4b647e; font-weight:700; margin-top:20px; font-weight:700;" >';
		est 	+= 	'<img id="p_foto_edit" src="'+p_root+'" width="95" height="94" border="0" style="border-radius:5px;  box-shadow: 1px 0px 5px 0px rgba(33,33,33,1); " />'; // box-shadow: 1px 0px 5px 0px rgba(33,33,33,1); rgba(169,169,169,1); rgba(123,155,187,1);
		est 	+= 	'</div>';
		
		est 	+= 	'<form name="form_f_perfil" id="form_f_perfil">';
		est 	+=		'<div style="float:left; width:100%; margin-top:40px;" >';
		est 	+= 	'<label for="file-upload1" class="custom-file-upload-perfil" style="margin-top:20px;" >';
		est 	+= 	'Cambiar imagen';
		est 	+= 	'</label>';
		est 	+= 	'<input id="file-upload1" type="file" name="foto_perfil" onChange="chgnPicture( this.value )" />';
		est 	+= 	'</div>';
		est 	+= 	'</form>';
		
		est 	+= 	'<div style="float:left; width:100%;" >';
		est 	+= 	'<a href="javascript:savePicture( );" class="buttom-confirm-sesion"   >';
		est 	+= 	'Guardar cambios';
		est 	+= 	'</a>';
		est 	+= 	'</div>'; 
				
		return est;
	}
	
	/*
	 * Configuracion del grafico de torta
     */	
	function graphPieBk( id , data ) 
	{
		var placeholder = $j(id);
		placeholder.unbind();
		$j.plot(placeholder, data, 
		{
				series: {
					pie: { 
						show: true,
						radius: 1,
						label: {
							show: false			
						},
						stroke: {
							width: 0.1,
							color: '#808080'
						}
					}
				},
				legend: {
					show: false
				}
		});
	};
	
	/* Funcion para crear grafico de consumo de disco */
	function createGraph()
	{
		var parametros_grafico = {
				"acc": 'get_graph'
		}
			
		$j.ajax({
			data:  parametros_grafico,
			url:   'header_session_get.php',
			type: 'POST',
			dataType : 'json',
			beforeSend: function () {
					  //$('#graph_pie').html('');
			},
			success:  function (response) 
			{
				graphPieBk('#graph_space_disk', response.graph );

				var elemento = '';
				var color = '';
				var valor = '';
				var leyenda = '';
					
				for(var i = 0; i < 6; i++)
				{
					var obj = response.leyenda[i];
					$j.each( obj, function( key, value ) 
					{
						if(key == 'label')
						{
								elemento = value;
						}
						if(key == 'color')
						{
							color = value;
						}
						if(key == 'data')
						{
							valor = value;
						}
					});
					leyenda += '<span style="float:left; clear:both; font-size:11px; font-family: Arial, Helvetica, sans-serif; padding-top:2px; padding-left:0px;"><span style="float:left; text-align:left;"><span style="color:#94BF10;">&#8226;</span> '+elemento+': </span><span style="float:left; font-weight:bold; color:'+color+';">&nbsp;'+valor+' gb</span></span>';
				}
				$j('#leyenda_space_disk').html(leyenda);
				
			
				
				$j('#BK_Online_Status').html( get_status_bk(  response.bk_status.BK_Online_Status ) );
				$j('#BK_Online_Fecha').html( response.bk_status.BK_Online_Fecha );
				
				$j('#BK_Local_Status').html( get_status_bk( response.bk_status.BK_Local_Status ) );
				$j('#BK_Local_Fecha').html( response.bk_status.BK_Local_Fecha );
				
				
			}
		});
	}
	
	/*Funcion devuelve tipo de status de backup */
	function get_status_bk( dato )
	{
		var status = '';
		switch( dato )
		{
			case '0':
				status = '<span style="color:#D44F44;">No encuentra archivo.</span>';
				break;
			case '1':
				status = '<span style="color:#D44F44;">Backup desactualizado.</span>';
				break;
			case '2':
				status = '<span style="color:#D44F44;">Error al copiar archivo.</span>';
				break;
			case '3':
				status = '<span style="color:#1BA05F;">Realizado satisfactoriamente.</span>';
				break;
			case '4':
				status = '<span style="color:#D44F44;">Servicio no activo.</span>';
				break;
		}
		return status;
	}
	
	/* Funcion de carga de datos de perfil */
	function loadPerfil()
	{
		
		var parametros = {
				"acc": 'l_per'
		}
			
		$j.ajax({
			data:  parametros,
			url:   'header_session_get.php',
			type: 'POST',
			dataType : 'json',
			beforeSend: function () {
					  //$('#graph_pie').html('');
			},
			success:  function (data) 
			{
				
				$j('#P_User').val( data.User );
			//	$j('#P_Pass').val( data.Pass );
				$j('#P_Sede_Select').html( data.Sede_Options );
				$j('#P_Nombres').val( data.Nombres );
				$j('#P_Apellido').val( data.Apellido );
				$j('#P_Occupation').val( data.Occupation );
				$j('#P_Direccion').val( data.Direccion );
				$j('#P_Celular').val( data.Celular );
				$j('#P_E_Mail').val( data.E_Mail );
				
			}
		});
	}
	
	/* Funcion guardar  datos de perfil */
	function savePerfil(  )
	{		
		
		var data =  $j('#form_p').serialize();
	
		
		$j.ajax({
			url		 : 'header_session_get.php',
			type: 'POST',
					
			data	 : data,
			dataType : 'json',
			cache: false, 
			success: function(data){
				
				
				parent.location.href = '?session_off=1&idu=<?PHP echo $data_user_in[0]; ?>';
			}
		});
	
	}
	
	/* Funcion para guardar nueva imagen */
	function savePicture()
	{
		var form = $j('#form_f_perfil');
		var data_form = new FormData();
	
		$j.each( form.find('input[type="file"]'), function( i, tag) {
			$j.each( $j(tag)[0].files , function( i , file) 
			{
					
				data_form.append( tag.name, file );
			});
		});
		data_form.append( 'acc', 's_f_per' );
		
		$j.ajax({
			url		 : 'header_session_get.php',
			data	 : data_form,
			type : 'POST',
			dataType : 'json',
			processData: false,
			contentType: false,
			success: function( data ){
				
			
				if( data != 'null' )
				{
					document.getElementById("p_foto_edit").src = data ;
					document.getElementById("p_foto_header").src= data ;
					document.getElementById("p_root").value = data ;
				}
				
				
				
			}
		});
	
	}
	/* Funcion de carga de  nueva imagen */
	function chgnPicture( e )
	{
		
	}
	// Oculta ventana de perfil
	$j(document).mouseup(function(e){
		var nft = $j(".outerNtf");

		// Verifica sin 
		if(!nft.is(e.target) && nft.has(e.target).length === 0){
			nft.hide();
		}
});
</script>					
